"use strict";

const config = window.IMPERIO_GLOW_CONFIG || {};
const supabaseUrl = String(config.supabaseUrl || "").trim();
const supabaseAnonKey = String(config.supabaseAnonKey || "").trim();
const authorizedUserId = String(config.authorizedUserId || "").trim();
const supabaseReady = Boolean(
    window.supabase &&
    typeof window.supabase.createClient === "function" &&
    supabaseUrl &&
    supabaseAnonKey
);
const supabaseClient = supabaseReady
    ? window.supabase.createClient(supabaseUrl, supabaseAnonKey)
    : null;

const loginCard = document.getElementById("loginCard");
const adminCard = document.getElementById("adminCard");
const loginForm = document.getElementById("loginForm");
const productForm = document.getElementById("productForm");
const typeForm = document.getElementById("typeForm");
const loginFeedback = document.getElementById("loginFeedback");
const saveFeedback = document.getElementById("saveFeedback");
const inventoryFeedback = document.getElementById("inventoryFeedback");
const typeFeedback = document.getElementById("typeFeedback");
const typeLoadFeedback = document.getElementById("typeLoadFeedback");
const inventoryList = document.getElementById("inventoryList");
const typeList = document.getElementById("typeList");
const newTypeName = document.getElementById("newTypeName");
const productName = document.getElementById("productName");
const productPrice = document.getElementById("productPrice");
const productType = document.getElementById("productType");
const productInfo = document.getElementById("productInfo");
const productImage = document.getElementById("productImage");
const galleryImagesInput = document.getElementById("galleryImagesInput");
const galleryExisting = document.getElementById("galleryExisting");
const galleryUploadList = document.getElementById("galleryUploadList");
const previewImage = document.getElementById("previewImage");
const imagePlaceholder = document.getElementById("imagePlaceholder");
const imageEditHint = document.getElementById("imageEditHint");
const fileName = document.getElementById("fileName");
const btnLogin = document.getElementById("btnLogin");
const btnAddType = document.getElementById("btnAddType");
const btnSave = document.getElementById("btnSave");
const btnCancelEdit = document.getElementById("btnCancelEdit");
const btnLogout = document.getElementById("btnLogout");
const formHeading = document.getElementById("formHeading");
const formDescription = document.getElementById("formDescription");
const pageTitle = document.getElementById("pageTitle");

let products = [];
let types = [];
let editingProduct = null;
let currentUserId = null;
let adminRealtimeChannel = null;
let refreshTimer = null;
let previewUrl = null;
let galleryImages = [];
let pendingGalleryImages = [];
let editingTypeId = null;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

document.getElementById("year").textContent = new Date().getFullYear();

function showFeedback(element, message, type = "") {
    element.textContent = message;
    element.className = "feedback";
    if (type) element.classList.add(type);
}

function errorMessage(error) {
    const message = error?.message || String(error);
    console.error("Erro no painel Imperio Glow:", error);

    if (/invalid login credentials/i.test(message)) {
        return "E-mail ou senha incorretos.";
    }
    if (/email not confirmed/i.test(message)) {
        return "Confirme seu e-mail antes de entrar.";
    }
    if (/imagem_url/i.test(message) && /(column|schema cache|does not exist|could not find)/i.test(message)) {
        return "A coluna imagem_url ainda não existe. Execute no SQL Editor: ALTER TABLE public.maquiagens ADD COLUMN IF NOT EXISTS imagem_url text;";
    }
    if (/gallery_images/i.test(message) && /(column|schema cache|does not exist|could not find)/i.test(message)) {
        return "A coluna gallery_images ainda não existe. Execute a migração atualizada do arquivo supabase-setup.sql no SQL Editor do Supabase.";
    }
    if (/bucket not found/i.test(message)) {
        return "O bucket 'produtos' não foi encontrado no Storage do Supabase.";
    }
    if (/row-level security|violates row-level security|permission denied/i.test(message)) {
        return "Sem permissão para concluir esta operação. Confira as políticas RLS das tabelas maquiagens, tipos e do bucket produtos.";
    }
    if (/duplicate key|unique constraint/i.test(message)) {
        return "Esse tipo já está cadastrado. Escolha outro nome.";
    }
    if (/failed to fetch|networkerror/i.test(message)) {
        return "Não foi possível conectar ao Supabase. Confira a internet e a URL do projeto.";
    }
    return `Não foi possível concluir a operação: ${message}`;
}

function normalizeName(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLocaleLowerCase("pt-BR");
}

function formatPrice(value) {
    const price = Number(value);
    if (!Number.isFinite(price)) return "Valor inválido";
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL"
    }).format(price);
}

function typeName(typeId) {
    return types.find((type) => String(type.id) === String(typeId))?.nome ||
        "Sem tipo associado";
}

function normalizeGallery(images) {
    if (!Array.isArray(images)) return [];
    return [...new Set(images
        .map((image) => typeof image === "string" ? image : image?.url)
        .filter((url) => typeof url === "string" && url.trim())
        .map((url) => url.trim()))];
}

function renderGalleryEditor() {
    galleryExisting.replaceChildren();
    galleryUploadList.replaceChildren();

    galleryImages.forEach((url, index) => {
        galleryExisting.append(createGalleryPhotoItem({
            url,
            label: `Foto ${index + 1}`,
            action: "remove-existing",
            index
        }));
    });

    pendingGalleryImages.forEach((image, index) => {
        galleryUploadList.append(createGalleryPhotoItem({
            url: image.previewUrl,
            label: image.file.name,
            action: "remove-upload",
            index
        }));
    });
}

function createGalleryPhotoItem({ url, label, action, index }) {
    const item = document.createElement("div");
    item.className = "gallery-photo-item";

    const image = document.createElement("img");
    image.src = url;
    image.alt = label;
    image.loading = "lazy";

    const name = document.createElement("span");
    name.textContent = label;
    name.title = label;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn-delete";
    remove.dataset.galleryAction = action;
    remove.dataset.index = String(index);
    remove.textContent = "Remover";
    remove.setAttribute("aria-label", `Remover ${label}`);

    item.append(image, name, remove);
    return item;
}

function clearGalleryEditor() {
    pendingGalleryImages.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    pendingGalleryImages = [];
    galleryImages = [];
    galleryImagesInput.value = "";
    renderGalleryEditor();
}

function renderTypeOptions(selectedId = productType.value) {
    productType.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = types.length
        ? "Selecione um tipo"
        : "Cadastre um tipo primeiro";
    productType.append(placeholder);

    types.forEach((type) => {
        const option = document.createElement("option");
        option.value = String(type.id);
        option.textContent = type.nome;
        productType.append(option);
    });

    productType.disabled = types.length === 0;
    productType.value = types.some((type) => String(type.id) === String(selectedId))
        ? String(selectedId)
        : "";
}

function renderTypesList() {
    typeList.replaceChildren();

    if (types.length === 0) {
        const empty = document.createElement("p");
        empty.className = "type-empty";
        empty.textContent = "Nenhum tipo cadastrado ainda.";
        typeList.append(empty);
        return;
    }

    types.forEach((type) => {
        const row = document.createElement("div");
        row.className = "type-list-item";
        row.dataset.typeId = String(type.id);

        if (editingTypeId === String(type.id)) {
            const input = document.createElement("input");
            input.type = "text";
            input.className = "type-name-input";
            input.maxLength = 80;
            input.value = type.nome;
            input.setAttribute("aria-label", `Nome do tipo ${type.nome}`);

            const actions = document.createElement("div");
            actions.className = "type-list-actions";

            const save = document.createElement("button");
            save.type = "button";
            save.className = "btn-primary";
            save.dataset.action = "save-type";
            save.textContent = "Salvar";

            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "btn-secondary";
            cancel.dataset.action = "cancel-type";
            cancel.textContent = "Cancelar";
            actions.append(save, cancel);
            row.append(input, actions);
        } else {
            const name = document.createElement("span");
            name.className = "type-name";
            name.textContent = type.nome;

            const count = products.filter(
                (product) => String(product.tipo_id) === String(type.id)
            ).length;
            const usage = document.createElement("span");
            usage.className = "type-count";
            usage.textContent = `${count} ${count === 1 ? "produto" : "produtos"}`;

            const actions = document.createElement("div");
            actions.className = "type-list-actions";

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "btn-edit";
            edit.dataset.action = "edit-type";
            edit.textContent = "Editar";
            edit.setAttribute("aria-label", `Editar tipo ${type.nome}`);

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "btn-delete";
            remove.dataset.action = "delete-type";
            remove.textContent = "Excluir";
            remove.setAttribute("aria-label", `Excluir tipo ${type.nome}`);
            actions.append(edit, remove);
            row.append(name, usage, actions);
        }

        typeList.append(row);
    });
}

async function loadTypes() {
    const { data, error } = await supabaseClient
        .from("tipos")
        .select("id, nome")
        .order("nome", { ascending: true });

    if (error) throw error;

    const selectedId = productType.value;
    types = data || [];
    renderTypeOptions(selectedId);
    renderTypesList();
    showFeedback(typeLoadFeedback, "");
}

function renderProducts() {
    inventoryList.replaceChildren();

    if (products.length === 0) {
        const message = document.createElement("p");
        message.className = "muted";
        message.textContent = "Ainda não há maquiagens cadastradas.";
        inventoryList.append(message);
        return;
    }

    products.forEach((product) => {
        const item = document.createElement("article");
        item.className = "inventory-item";

        const image = document.createElement("img");
        image.className = "inventory-cover";
        image.alt = `Foto de ${product.nome}`;
        image.loading = "lazy";
        if (product.imagem_url) {
            image.src = product.imagem_url;
        } else {
            image.classList.add("product-admin-icon");
            image.alt = "";
            image.src = "assets/logo-imperio-glow.jpg";
        }

        const details = document.createElement("div");
        details.className = "inventory-details";

        const name = document.createElement("h3");
        name.textContent = product.nome;

        const metadata = document.createElement("p");
        metadata.textContent = `${formatPrice(product.preco)} · ${typeName(product.tipo_id)}`;

        details.append(name, metadata);

        const actions = document.createElement("div");
        actions.className = "inventory-actions";

        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "btn-edit";
        editButton.dataset.action = "edit";
        editButton.dataset.productId = String(product.id);
        editButton.textContent = "Editar";
        editButton.setAttribute("aria-label", `Editar ${product.nome}`);

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "btn-delete";
        deleteButton.dataset.action = "delete";
        deleteButton.dataset.productId = String(product.id);
        deleteButton.textContent = "Excluir";
        deleteButton.setAttribute("aria-label", `Excluir ${product.nome}`);

        actions.append(editButton, deleteButton);
        item.append(image, details, actions);
        inventoryList.append(item);
    });
}

async function loadProducts() {
    inventoryList.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "muted";
    loading.textContent = "Carregando produtos cadastrados...";
    inventoryList.append(loading);
    showFeedback(inventoryFeedback, "");

    let result = await supabaseClient
        .from("maquiagens")
        .select("id, nome, preco, informacoes, tipo_id, imagem_url, gallery_images, criado_em")
        .order("criado_em", { ascending: false });

    if (
        result.error &&
        /(imagem_url|gallery_images)/i.test(result.error.message || "") &&
        /(column|schema cache|does not exist|could not find)/i.test(result.error.message || "")
    ) {
        console.warn("Uma coluna de fotos ainda não existe; tentando carregar os produtos sem ela.");
        result = await supabaseClient
            .from("maquiagens")
            .select("id, nome, preco, informacoes, tipo_id, imagem_url, criado_em")
            .order("criado_em", { ascending: false });
        if (
            result.error &&
            /imagem_url/i.test(result.error.message || "") &&
            /(column|schema cache|does not exist|could not find)/i.test(result.error.message || "")
        ) {
            result = await supabaseClient
                .from("maquiagens")
                .select("id, nome, preco, informacoes, tipo_id, criado_em")
                .order("criado_em", { ascending: false });
        }
    }

    if (result.error) throw result.error;

    products = (result.data || []).map((product) => ({
        ...product,
        imagem_url: product.imagem_url || null,
        gallery_images: normalizeGallery(product.gallery_images)
    }));
    renderProducts();
    renderTypesList();
}

async function loadDashboard() {
    try {
        await loadTypes();
        await loadProducts();
    } catch (error) {
        inventoryList.replaceChildren();
        showFeedback(inventoryFeedback, errorMessage(error), "error");
    }
}

function startRealtimeUpdates() {
    if (!supabaseClient || adminRealtimeChannel) return;

    adminRealtimeChannel = supabaseClient
        .channel("imperio-glow-admin")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "maquiagens" },
            () => scheduleDashboardRefresh(false)
        )
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "tipos" },
            () => scheduleDashboardRefresh(true)
        )
        .subscribe((status, error) => {
            if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
                console.error("Não foi possível receber atualizações em tempo real:", error || status);
            }
        });
}

function scheduleDashboardRefresh(refreshTypes) {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(async () => {
        try {
            if (refreshTypes) await loadTypes();
            await loadProducts();
        } catch (error) {
            showFeedback(inventoryFeedback, errorMessage(error), "error");
        }
    }, 150);
}

async function stopRealtimeUpdates() {
    if (!adminRealtimeChannel || !supabaseClient) return;

    const channel = adminRealtimeChannel;
    adminRealtimeChannel = null;
    window.clearTimeout(refreshTimer);
    try {
        const status = await supabaseClient.removeChannel(channel);
        if (status !== "ok") {
            console.error("Não foi possível encerrar o canal Realtime:", status);
        }
    } catch (error) {
        console.error("Erro ao encerrar o canal Realtime:", error);
    }
}

async function handleSession(session) {
    if (session && !authorizedUserId) {
        loginCard.classList.remove("hidden");
        adminCard.classList.add("hidden");
        pageTitle.textContent = "Acesso administrativo";
        showFeedback(loginFeedback, "Configure o UID autorizado em config.js antes de acessar o painel.", "error");
        const { error } = await supabaseClient.auth.signOut();
        if (error) console.error("Não foi possível encerrar uma sessão sem UID autorizado:", error);
        return;
    }

    if (session && session.user.id !== authorizedUserId) {
        loginCard.classList.remove("hidden");
        adminCard.classList.add("hidden");
        pageTitle.textContent = "Acesso administrativo";
        showFeedback(loginFeedback, "Esta conta não está autorizada para administrar o Imperio Glow.", "error");
        const { error } = await supabaseClient.auth.signOut();
        if (error) console.error("Não foi possível encerrar a sessão de um usuário não autorizado:", error);
        return;
    }

    const userId = session?.user?.id || null;
    const changed = userId !== currentUserId;
    currentUserId = userId;

    loginCard.classList.toggle("hidden", Boolean(session));
    adminCard.classList.toggle("hidden", !session);
    pageTitle.textContent = session ? "Gerenciamento da vitrine" : "Acesso administrativo";

    if (session && changed) {
        await loadDashboard();
        startRealtimeUpdates();
    } else if (!session && changed) {
        await stopRealtimeUpdates();
        products = [];
        types = [];
        productForm.reset();
        showFeedback(inventoryFeedback, "");
        inventoryList.replaceChildren();
    }
}

function beginEditing(product) {
    if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
    }
    productImage.value = "";
    clearGalleryEditor();
    editingProduct = product;
    galleryImages = normalizeGallery(product.gallery_images);
    renderGalleryEditor();
    productName.value = product.nome || "";
    productPrice.value = product.preco ?? "";
    productInfo.value = product.informacoes || "";
    renderTypeOptions(product.tipo_id);
    productImage.required = false;
    imageEditHint.classList.remove("hidden");
    imagePlaceholder.classList.add("hidden");
    previewImage.src = product.imagem_url || "assets/logo-imperio-glow.jpg";
    previewImage.alt = product.imagem_url
        ? `Foto atual de ${product.nome}`
        : "Logo Imperio Glow";
    previewImage.classList.remove("hidden");
    fileName.textContent = product.imagem_url
        ? "Foto atual. Selecione outra para substituir."
        : "Este produto ainda não tem foto.";

    formHeading.textContent = "Editar maquiagem";
    formDescription.textContent = "Atualize as informações do produto e salve as alterações.";
    btnSave.innerHTML = 'Salvar alterações <span>↗</span>';
    btnCancelEdit.classList.remove("hidden");
    showFeedback(saveFeedback, "");
    document.getElementById("cadastro").scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

function resetProductForm() {
    editingProduct = null;
    clearGalleryEditor();
    productImage.required = true;
    imageEditHint.classList.add("hidden");
    formHeading.textContent = "Cadastrar maquiagem";
    formDescription.textContent = "Preencha os dados abaixo para publicar na vitrine.";
    btnSave.innerHTML = 'Publicar produto <span>↗</span>';
    btnCancelEdit.classList.add("hidden");
    showFeedback(saveFeedback, "");
    renderTypeOptions();
    if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
    }
    productImage.value = "";
    previewImage.removeAttribute("src");
    previewImage.classList.add("hidden");
    imagePlaceholder.classList.remove("hidden");
    fileName.textContent = "Nenhuma imagem selecionada.";
}

function getStorageObjectPath(imageUrl) {
    if (typeof imageUrl !== "string" || !imageUrl) return null;

    try {
        const image = new URL(imageUrl);
        const project = new URL(supabaseUrl);
        const bucketPrefix = "/storage/v1/object/public/produtos/";
        if (image.origin !== project.origin || !image.pathname.includes(bucketPrefix)) {
            return null;
        }

        return image.pathname
            .slice(image.pathname.indexOf(bucketPrefix) + bucketPrefix.length)
            .split("/")
            .map((segment) => decodeURIComponent(segment))
            .join("/");
    } catch (error) {
        console.error("Não foi possível interpretar a URL da foto:", error);
        return null;
    }
}

async function uploadProductImage(file, userId) {
    const extensionByType = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp"
    };
    const path = `${userId}/${crypto.randomUUID()}.${extensionByType[file.type]}`;
    const { error } = await supabaseClient.storage
        .from("produtos")
        .upload(path, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type
        });

    if (error) throw error;

    const { data } = supabaseClient.storage
        .from("produtos")
        .getPublicUrl(path);
    if (!data.publicUrl) {
        throw new Error("Não foi possível obter a URL pública da foto.");
    }
    return { path, url: data.publicUrl };
}

async function removeProductImage(imageUrl) {
    const path = getStorageObjectPath(imageUrl);
    if (!path) return;

    const { error } = await supabaseClient.storage
        .from("produtos")
        .remove([path]);
    if (error) throw error;
}

productImage.addEventListener("change", () => {
    const file = productImage.files[0];
    showFeedback(saveFeedback, "");

    if (!file) {
        if (editingProduct) {
            previewImage.src = editingProduct.imagem_url || "assets/logo-imperio-glow.jpg";
            previewImage.classList.remove("hidden");
            imagePlaceholder.classList.add("hidden");
            fileName.textContent = editingProduct.imagem_url
                ? "Foto atual. Selecione outra para substituir."
                : "Este produto ainda não tem foto.";
        }
        return;
    }

    if (!ALLOWED_IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_SIZE) {
        productImage.value = "";
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
        }
        if (editingProduct?.imagem_url) {
            previewImage.src = editingProduct.imagem_url;
            previewImage.classList.remove("hidden");
            imagePlaceholder.classList.add("hidden");
            fileName.textContent = "Foto atual. Selecione outra para substituir.";
        } else {
            previewImage.removeAttribute("src");
            previewImage.classList.add("hidden");
            imagePlaceholder.classList.remove("hidden");
            fileName.textContent = "Nenhuma imagem selecionada.";
        }
        showFeedback(
            saveFeedback,
            !ALLOWED_IMAGE_TYPES.includes(file.type)
                ? "A foto deve ser JPG, PNG ou WebP."
                : "A foto deve ter no máximo 5 MB.",
            "error"
        );
        return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    previewImage.src = previewUrl;
    previewImage.alt = `Pré-visualização de ${file.name}`;
    previewImage.classList.remove("hidden");
    imagePlaceholder.classList.add("hidden");
    fileName.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
});

galleryImagesInput.addEventListener("change", () => {
    const selectedFiles = [...galleryImagesInput.files];
    galleryImagesInput.value = "";
    if (selectedFiles.length === 0) return;

    const invalidFile = selectedFiles.find((file) =>
        !ALLOWED_IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_SIZE
    );
    if (invalidFile) {
        showFeedback(
            saveFeedback,
            !ALLOWED_IMAGE_TYPES.includes(invalidFile.type)
                ? `"${invalidFile.name}" não é JPG, PNG ou WebP.`
                : `"${invalidFile.name}" excede o limite de 5 MB.`,
            "error"
        );
        return;
    }

    selectedFiles.forEach((file) => {
        pendingGalleryImages.push({
            file,
            previewUrl: URL.createObjectURL(file)
        });
    });
    renderGalleryEditor();
    showFeedback(saveFeedback, "");
});

galleryExisting.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-gallery-action]");
    if (!button || button.dataset.galleryAction !== "remove-existing") return;
    galleryImages.splice(Number(button.dataset.index), 1);
    renderGalleryEditor();
});

galleryUploadList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-gallery-action]");
    if (!button || button.dataset.galleryAction !== "remove-upload") return;
    const [image] = pendingGalleryImages.splice(Number(button.dataset.index), 1);
    if (image) URL.revokeObjectURL(image.previewUrl);
    renderGalleryEditor();
});

async function createType(event) {
    event.preventDefault();
    const name = newTypeName.value.trim();
    if (!name) return;

    if (types.some((type) => normalizeName(type.nome) === normalizeName(name))) {
        showFeedback(typeFeedback, "Esse tipo já está cadastrado.", "error");
        return;
    }

    btnAddType.disabled = true;
    btnAddType.textContent = "Adicionando...";
    showFeedback(typeFeedback, "");

    try {
        await requireAuthorizedUser();
        const { data, error } = await supabaseClient
            .from("tipos")
            .insert({ nome: name })
            .select("id, nome")
            .single();

        if (error) throw error;

        await loadTypes();
        productType.value = String(data.id);
        newTypeName.value = "";
        showFeedback(typeFeedback, "Tipo adicionado. Ele já está disponível no cadastro e na vitrine.", "success");
    } catch (error) {
        showFeedback(typeFeedback, errorMessage(error), "error");
        try {
            await loadTypes();
        } catch (refreshError) {
            console.error("Não foi possível atualizar a lista de tipos:", refreshError);
        }
    } finally {
        btnAddType.disabled = false;
        btnAddType.textContent = "Adicionar tipo";
    }
}

function editType(typeId) {
    editingTypeId = String(typeId);
    showFeedback(typeFeedback, "");
    renderTypesList();
    typeList.querySelector(".type-name-input")?.focus();
}

async function saveType(typeId, button) {
    const row = button.closest(".type-list-item");
    const input = row.querySelector(".type-name-input");
    const name = input.value.trim();
    const currentType = types.find((type) => String(type.id) === String(typeId));
    if (!currentType) return;

    if (!name) {
        showFeedback(typeFeedback, "Informe o nome do tipo.", "error");
        input.focus();
        return;
    }

    if (
        types.some((type) =>
            String(type.id) !== String(typeId) &&
            normalizeName(type.nome) === normalizeName(name)
        )
    ) {
        showFeedback(typeFeedback, "Já existe outro tipo com esse nome.", "error");
        input.focus();
        return;
    }

    button.disabled = true;
    button.textContent = "Salvando...";
    showFeedback(typeFeedback, "");

    try {
        await requireAuthorizedUser();
        const { data, error } = await supabaseClient
            .from("tipos")
            .update({ nome: name })
            .eq("id", typeId)
            .select("id");

        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error("O tipo não foi atualizado. Confira a política UPDATE para tipos.");
        }

        editingTypeId = null;
        await loadTypes();
        showFeedback(typeFeedback, "Tipo corrigido com sucesso.", "success");
    } catch (error) {
        showFeedback(typeFeedback, errorMessage(error), "error");
    } finally {
        if (button.isConnected) {
            button.disabled = false;
            button.textContent = "Salvar";
        }
    }
}

async function deleteType(typeId, button) {
    const type = types.find((item) => String(item.id) === String(typeId));
    if (!type) return;

    button.disabled = true;
    button.textContent = "Verificando...";
    showFeedback(typeFeedback, "");

    try {
        await requireAuthorizedUser();
        const { count, error: countError } = await supabaseClient
            .from("maquiagens")
            .select("id", { count: "exact", head: true })
            .eq("tipo_id", typeId);

        if (countError) throw countError;
        if (count > 0) {
            showFeedback(
                typeFeedback,
                `Não é possível excluir "${type.nome}" porque ${count} ${count === 1 ? "produto usa esse tipo" : "produtos usam esse tipo"}. Edite os produtos e escolha outro tipo primeiro.`,
                "error"
            );
            return;
        }

        if (!window.confirm(`Excluir o tipo "${type.nome}"?`)) return;

        button.textContent = "Excluindo...";
        const { data, error } = await supabaseClient
            .from("tipos")
            .delete()
            .eq("id", typeId)
            .select("id");

        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error("O tipo não foi excluído. Confira a política DELETE para tipos.");
        }

        if (editingTypeId === String(typeId)) editingTypeId = null;
        if (String(productType.value) === String(typeId)) productType.value = "";
        await loadTypes();
        showFeedback(typeFeedback, "Tipo excluído.", "success");
    } catch (error) {
        showFeedback(typeFeedback, errorMessage(error), "error");
    } finally {
        if (button.isConnected) {
            button.disabled = false;
            button.textContent = "Excluir";
        }
    }
}

async function requireAuthorizedUser() {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (!data.session || data.session.user.id !== authorizedUserId) {
        throw new Error("Sua sessão não está autorizada para alterar tipos ou produtos.");
    }
}

async function saveProduct(event) {
    event.preventDefault();
    showFeedback(saveFeedback, "");

    const name = productName.value.trim();
    const price = Number(productPrice.value);
    const typeId = productType.value;
    const imageFile = productImage.files[0] || null;
    const additionalFiles = pendingGalleryImages.map((image) => image.file);

    if (!name) {
        showFeedback(saveFeedback, "Informe o nome da maquiagem.", "error");
        return;
    }
    if (!productPrice.value || !Number.isFinite(price) || price < 0) {
        showFeedback(saveFeedback, "Informe um preço válido, igual ou maior que zero.", "error");
        return;
    }
    if (!types.some((type) => String(type.id) === String(typeId))) {
        showFeedback(saveFeedback, "Selecione um tipo cadastrado.", "error");
        return;
    }
    if (!imageFile && !editingProduct?.imagem_url) {
        showFeedback(saveFeedback, "Selecione uma foto para o produto.", "error");
        return;
    }
    if (imageFile && !ALLOWED_IMAGE_TYPES.includes(imageFile.type)) {
        showFeedback(saveFeedback, "A foto deve ser JPG, PNG ou WebP.", "error");
        return;
    }
    if (imageFile && imageFile.size > MAX_IMAGE_SIZE) {
        showFeedback(saveFeedback, "A foto deve ter no máximo 5 MB.", "error");
        return;
    }
    const invalidGalleryFile = additionalFiles.find((file) =>
        !ALLOWED_IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_SIZE
    );
    if (invalidGalleryFile) {
        showFeedback(saveFeedback, `Verifique o formato e o tamanho de "${invalidGalleryFile.name}".`, "error");
        return;
    }

    const wasEditing = Boolean(editingProduct);
    const productData = {
        nome: name,
        preco: price,
        informacoes: productInfo.value.trim() || null,
        tipo_id: typeId
    };

    btnSave.disabled = true;
    btnSave.textContent = wasEditing ? "Salvando alterações..." : "Publicando...";
    const uploadedImages = [];
    let recordSaved = false;

    try {
        const { data: sessionData, error: sessionError } =
            await supabaseClient.auth.getSession();
        if (sessionError) throw sessionError;
        if (!sessionData.session || sessionData.session.user.id !== authorizedUserId) {
            throw new Error("Sua sessão não está autorizada para alterar a vitrine.");
        }

        const uploadedCover = imageFile
            ? await uploadProductImage(imageFile, sessionData.session.user.id)
            : null;
        if (uploadedCover) uploadedImages.push(uploadedCover);
        const uploadedGallery = [];
        for (const file of additionalFiles) {
            const image = await uploadProductImage(file, sessionData.session.user.id);
            uploadedImages.push(image);
            uploadedGallery.push(image.url);
        }

        const savedGallery = [...galleryImages, ...uploadedGallery];
        productData.imagem_url = uploadedCover?.url || editingProduct?.imagem_url;
        productData.gallery_images = savedGallery;

        if (wasEditing) {
            const { data, error } = await supabaseClient
                .from("maquiagens")
                .update(productData)
                .eq("id", editingProduct.id)
                .select("id");

            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error("O produto não foi atualizado. Confira a política UPDATE para maquiagens.");
            }
        } else {
            const { error } = await supabaseClient
                .from("maquiagens")
                .insert(productData);

            if (error) throw error;
        }

        recordSaved = true;
        const retainedImages = new Set([
            productData.imagem_url,
            ...savedGallery
        ].filter(Boolean));
        const oldImages = [...new Set([
            editingProduct?.imagem_url,
            ...normalizeGallery(editingProduct?.gallery_images)
        ].filter((url) => url && !retainedImages.has(url)))];
        const cleanupErrors = [];
        for (const imageUrl of oldImages) {
            try {
                await removeProductImage(imageUrl);
            } catch (error) {
                console.error("O produto foi salvo, mas uma foto antiga não foi removida:", error);
                cleanupErrors.push(errorMessage(error));
            }
        }

        await loadProducts();
        productForm.reset();
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        const cleanupWarning = cleanupErrors.length
            ? `Produto salvo, mas ${cleanupErrors.length} foto(s) antiga(s) permaneceram no bucket.`
            : "";
        showFeedback(
            saveFeedback,
            cleanupWarning || (wasEditing
                ? "Maquiagem atualizada com sucesso."
                : "Maquiagem cadastrada com sucesso."),
            cleanupWarning ? "error" : "success"
        );
    } catch (error) {
        showFeedback(
            saveFeedback,
            recordSaved
                ? `Produto salvo, mas não foi possível atualizar a lista: ${errorMessage(error)}`
                : errorMessage(error),
            "error"
        );
        if (uploadedImages.length && !recordSaved) {
            const paths = uploadedImages.map((image) => image.path);
            try {
                const { error: cleanupError } = await supabaseClient.storage
                    .from("produtos")
                    .remove(paths);
                if (cleanupError) throw cleanupError;
            } catch (cleanupError) {
                console.error("Não foi possível limpar as fotos enviadas após falha ao salvar:", cleanupError);
                showFeedback(
                    saveFeedback,
                    `${errorMessage(error)} As fotos enviadas também não puderam ser removidas do bucket.`,
                    "error"
                );
            }
        }
    } finally {
        btnSave.disabled = false;
        if (!editingProduct) {
            btnSave.innerHTML = 'Publicar produto <span>↗</span>';
        } else {
            btnSave.innerHTML = 'Salvar alterações <span>↗</span>';
        }
    }
}

async function deleteProduct(product, button) {
    if (!window.confirm(`Tem certeza que deseja excluir "${product.nome}" da vitrine?`)) {
        return;
    }

    button.disabled = true;
    button.textContent = "Excluindo...";
    showFeedback(inventoryFeedback, "");

    try {
        const { data: sessionData, error: sessionError } =
            await supabaseClient.auth.getSession();
        if (sessionError) throw sessionError;
        if (!sessionData.session || sessionData.session.user.id !== authorizedUserId) {
            throw new Error("Sua sessão não está autorizada para alterar a vitrine.");
        }

        const { data, error } = await supabaseClient
            .from("maquiagens")
            .delete()
            .eq("id", product.id)
            .select("id");

        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error("O produto não foi excluído. Confira a política DELETE para maquiagens.");
        }

        if (editingProduct && String(editingProduct.id) === String(product.id)) {
            productForm.reset();
        }
        await loadProducts();
        const imageUrls = [
            product.imagem_url,
            ...normalizeGallery(product.gallery_images)
        ].filter(Boolean);
        const cleanupErrors = [];
        for (const imageUrl of imageUrls) {
            try {
                await removeProductImage(imageUrl);
            } catch (error) {
                console.error("Produto removido, mas uma foto permaneceu no bucket:", error);
                cleanupErrors.push(errorMessage(error));
            }
        }
        showFeedback(
            inventoryFeedback,
            cleanupErrors.length
                ? `Produto removido, mas ${cleanupErrors.length} foto(s) permaneceram no bucket.`
                : "Produto removido da vitrine.",
            cleanupErrors.length ? "error" : "success"
        );
    } catch (error) {
        showFeedback(inventoryFeedback, errorMessage(error), "error");
        try {
            await loadProducts();
        } catch (refreshError) {
            showFeedback(inventoryFeedback, errorMessage(refreshError), "error");
        }
    }
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabaseClient) {
        showFeedback(loginFeedback, "O Supabase não está configurado. Confira URL e chave pública em config.js.", "error");
        return;
    }
    if (!authorizedUserId) {
        showFeedback(loginFeedback, "Configure o UID da conta autorizada em config.js antes de entrar.", "error");
        return;
    }

    btnLogin.disabled = true;
    btnLogin.textContent = "Autenticando...";
    showFeedback(loginFeedback, "");

    try {
        const email = document.getElementById("loginEmail").value.trim();
        const password = document.getElementById("loginPassword").value;
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        loginForm.reset();
    } catch (error) {
        showFeedback(loginFeedback, errorMessage(error), "error");
    } finally {
        btnLogin.disabled = false;
        btnLogin.innerHTML = 'Entrar no painel <span>→</span>';
    }
});

typeForm.addEventListener("submit", createType);
typeList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || button.disabled) return;

    const row = button.closest(".type-list-item");
    const typeId = row?.dataset.typeId;
    if (!typeId) return;

    if (button.dataset.action === "edit-type") {
        editType(typeId);
    } else if (button.dataset.action === "save-type") {
        saveType(typeId, button);
    } else if (button.dataset.action === "cancel-type") {
        editingTypeId = null;
        renderTypesList();
        showFeedback(typeFeedback, "");
    } else if (button.dataset.action === "delete-type") {
        deleteType(typeId, button);
    }
});
typeList.addEventListener("keydown", (event) => {
    const input = event.target.closest(".type-name-input");
    if (!input) return;

    const row = input.closest(".type-list-item");
    const saveButton = row.querySelector('[data-action="save-type"]');
    if (event.key === "Enter") {
        event.preventDefault();
        saveButton.click();
    } else if (event.key === "Escape") {
        editingTypeId = null;
        renderTypesList();
        showFeedback(typeFeedback, "");
    }
});
productForm.addEventListener("submit", saveProduct);
productForm.addEventListener("reset", () => {
    window.setTimeout(resetProductForm, 0);
});
btnCancelEdit.addEventListener("click", () => productForm.reset());

inventoryList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-product-id][data-action]");
    if (!button || button.disabled) return;

    const product = products.find((item) => String(item.id) === button.dataset.productId);
    if (!product) return;

    if (button.dataset.action === "edit") {
        beginEditing(product);
    } else if (button.dataset.action === "delete") {
        deleteProduct(product, button);
    }
});

btnLogout.addEventListener("click", async () => {
    btnLogout.disabled = true;
    try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
    } catch (error) {
        showFeedback(inventoryFeedback, errorMessage(error), "error");
    } finally {
        btnLogout.disabled = false;
    }
});

if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => {
            handleSession(session).catch((error) => {
                showFeedback(inventoryFeedback, errorMessage(error), "error");
            });
        }, 0);
    });

    supabaseClient.auth.getSession()
        .then(({ data, error }) => {
            if (error) throw error;
            return handleSession(data.session);
        })
        .catch((error) => {
            showFeedback(loginFeedback, errorMessage(error), "error");
        });
} else {
    showFeedback(loginFeedback, "O Supabase não está configurado. Confira a biblioteca e os dados em config.js.", "error");
}
