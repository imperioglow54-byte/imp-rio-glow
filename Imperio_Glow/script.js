"use strict";

const config = window.IMPERIO_GLOW_CONFIG || {};
const supabaseUrl = String(config.supabaseUrl || "").trim();
const supabaseAnonKey = String(config.supabaseAnonKey || "").trim();
const whatsappNumber = String(config.whatsappNumber || "").replace(/\D/g, "");
const supabaseReady = Boolean(
    window.supabase &&
    typeof window.supabase.createClient === "function" &&
    supabaseUrl &&
    supabaseAnonKey
);
const supabaseClient = supabaseReady
    ? window.supabase.createClient(supabaseUrl, supabaseAnonKey)
    : null;

const productGrid = document.getElementById("productGrid");
const filtersContainer = document.getElementById("catalogFilters");
const itemModal = document.getElementById("itemModal");
const modalCard = itemModal.querySelector(".modal-card");
const modalClose = document.getElementById("modalClose");
const modalTitle = document.getElementById("modalTitle");
const modalPrice = document.getElementById("modalPrice");
const modalDescription = document.getElementById("modalDescription");
const modalContact = document.getElementById("modalContact");
const modalImage = document.getElementById("modalImage");
const modalArt = document.getElementById("modalProductArt");
const modalGalleryThumbnails = document.getElementById("modalGalleryThumbnails");
const menuToggle = document.getElementById("menuToggle");
const mainNav = document.getElementById("mainNav");
const yearSpan = document.getElementById("year");

let products = [];
let types = [];
let activeFilterId = "todos";
let previouslyFocusedElement = null;
let catalogRealtimeChannel = null;
let catalogRefreshTimer = null;
let modalPhotoUrls = [];

function normalizeGallery(images) {
    if (!Array.isArray(images)) return [];
    return [...new Set(images
        .map((image) => typeof image === "string" ? image : image?.url)
        .filter((url) => typeof url === "string" && url.trim())
        .map((url) => url.trim()))];
}

function productPhotoUrls(product) {
    return [...new Set([
        product.imagem_url,
        ...normalizeGallery(product.gallery_images)
    ].filter((url) => typeof url === "string" && url.trim()))];
}

if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
}

if (menuToggle && mainNav) {
    menuToggle.addEventListener("click", () => {
        const isExpanded = menuToggle.getAttribute("aria-expanded") === "true";
        menuToggle.setAttribute("aria-expanded", String(!isExpanded));
        menuToggle.setAttribute("aria-label", isExpanded ? "Abrir menu" : "Fechar menu");
        mainNav.classList.toggle("open", !isExpanded);
    });

    mainNav.addEventListener("click", (event) => {
        if (!event.target.closest("a")) return;
        mainNav.classList.remove("open");
        menuToggle.setAttribute("aria-expanded", "false");
        menuToggle.setAttribute("aria-label", "Abrir menu");
    });
}

function showCatalogMessage(message, isError = false) {
    const state = document.createElement("div");
    state.className = "empty-state";

    const text = document.createElement("p");
    text.textContent = message;
    state.append(text);

    if (isError) {
        const retryButton = document.createElement("button");
        retryButton.type = "button";
        retryButton.className = "details-button";
        retryButton.textContent = "Tentar novamente";
        retryButton.addEventListener("click", loadCatalog);
        state.append(retryButton);
    }

    productGrid.replaceChildren(state);
}

function money(value) {
    const price = Number(value);
    if (!Number.isFinite(price)) return "Consulte o valor";

    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL"
    }).format(price);
}

function getTypeName(product) {
    const type = types.find((item) => String(item.id) === String(product.tipo_id));
    return type ? type.nome : "Outros produtos";
}

function makeWhatsAppUrl(product) {
    if (!whatsappNumber) return null;

    const message = [
        `Olá! Tenho interesse no produto ${product.nome}.`,
        `Valor: ${money(product.preco)}.`
    ].join(" ");

    return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
}

function createProductCard(product) {
    const card = document.createElement("article");
    card.className = "product-card";

    const art = document.createElement("div");
    art.className = "product-image product-art";
    art.setAttribute("aria-hidden", "true");

    const sparkle = document.createElement("span");
    sparkle.className = "product-art-sparkle";
    sparkle.textContent = "✦";

    const mark = document.createElement("span");
    mark.className = "product-art-mark";
    mark.textContent = "GLOW";

    const secondSparkle = document.createElement("span");
    secondSparkle.className = "product-art-sparkle";
    secondSparkle.textContent = "✧";
    art.append(sparkle, mark, secondSparkle);

    const coverUrl = product.imagem_url || normalizeGallery(product.gallery_images)[0];
    if (coverUrl) {
        art.classList.add("has-image");
        art.removeAttribute("aria-hidden");
        const image = document.createElement("img");
        image.src = coverUrl;
        image.alt = `Foto de ${product.nome}`;
        image.loading = "lazy";
        image.addEventListener("error", () => {
            image.remove();
            art.classList.remove("has-image");
        }, { once: true });
        art.append(image);
    }

    const info = document.createElement("div");
    info.className = "product-info";

    const type = document.createElement("span");
    type.className = "product-category";
    type.textContent = getTypeName(product);

    const name = document.createElement("h3");
    name.textContent = product.nome;

    const price = document.createElement("p");
    price.className = "product-price";
    price.textContent = money(product.preco);

    const description = document.createElement("p");
    description.className = "product-description";
    description.textContent = product.informacoes || "Fale com a gente para saber mais sobre este produto.";

    const actions = document.createElement("div");
    actions.className = "product-actions";

    const details = document.createElement("button");
    details.type = "button";
    details.className = "details-button";
    details.textContent = "Ver detalhes";
    details.addEventListener("click", () => openProductDetails(product));
    actions.append(details);

    const whatsappUrl = makeWhatsAppUrl(product);
    if (whatsappUrl) {
        const order = document.createElement("a");
        order.className = "order-button";
        order.href = whatsappUrl;
        order.target = "_blank";
        order.rel = "noopener noreferrer";
        order.textContent = "Pedir pelo WhatsApp ↗";
        actions.append(order);
    }

    info.append(type, name, price, description, actions);
    card.append(art, info);
    return card;
}

function renderProducts() {
    const visibleProducts = activeFilterId === "todos"
        ? products
        : products.filter((product) => String(product.tipo_id) === activeFilterId);

    if (visibleProducts.length === 0) {
        showCatalogMessage(
            products.length
                ? "Nenhum produto encontrado neste tipo."
                : "Ainda não há produtos cadastrados. Volte em breve!"
        );
        return;
    }

    productGrid.replaceChildren(...visibleProducts.map(createProductCard));
}

function renderFilters() {
    filtersContainer.replaceChildren();

    const allButton = document.createElement("button");
    allButton.className = "filter";
    allButton.type = "button";
    allButton.dataset.filter = "todos";
    allButton.textContent = "Todos os produtos";
    allButton.classList.toggle("active", activeFilterId === "todos");
    filtersContainer.append(allButton);

    types.forEach((type) => {
        const button = document.createElement("button");
        button.className = "filter";
        button.type = "button";
        button.dataset.filter = String(type.id);
        button.textContent = `✦ ${type.nome}`;
        button.classList.toggle("active", activeFilterId === String(type.id));
        filtersContainer.append(button);
    });

    if (
        activeFilterId !== "todos" &&
        !types.some((type) => String(type.id) === activeFilterId)
    ) {
        activeFilterId = "todos";
        allButton.classList.add("active");
    }
}

async function loadCatalog() {
    if (!supabaseClient) {
        showCatalogMessage(
            "Configure a URL do projeto Supabase e a chave anon/public em config.js para carregar os produtos.",
            true
        );
        return;
    }

    productGrid.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "loading-state";
    const spinner = document.createElement("span");
    spinner.className = "loading-disc";
    const message = document.createElement("p");
    message.textContent = "Preparando nossa vitrine de beleza...";
    loading.append(spinner, message);
    productGrid.append(loading);

    try {
        const [initialProductsResult, typesResult] = await Promise.all([
            supabaseClient
                .from("maquiagens")
                .select("id, nome, preco, informacoes, tipo_id, imagem_url, gallery_images, criado_em")
                .order("criado_em", { ascending: false }),
            supabaseClient
                .from("tipos")
                .select("id, nome")
                .order("nome", { ascending: true })
        ]);

        let productsResult = initialProductsResult;
        if (
            productsResult.error &&
            /(imagem_url|gallery_images)/i.test(productsResult.error.message || "") &&
            /(column|schema cache|does not exist|could not find)/i.test(productsResult.error.message || "")
        ) {
            console.warn("Uma coluna de fotos ainda não existe; tentando carregar os produtos sem ela.");
            productsResult = await supabaseClient
                .from("maquiagens")
                .select("id, nome, preco, informacoes, tipo_id, imagem_url, criado_em")
                .order("criado_em", { ascending: false });
            if (
                productsResult.error &&
                /imagem_url/i.test(productsResult.error.message || "") &&
                /(column|schema cache|does not exist|could not find)/i.test(productsResult.error.message || "")
            ) {
                productsResult = await supabaseClient
                    .from("maquiagens")
                    .select("id, nome, preco, informacoes, tipo_id, criado_em")
                    .order("criado_em", { ascending: false });
            }
        }

        if (productsResult.error) throw productsResult.error;
        if (typesResult.error) throw typesResult.error;

        products = (productsResult.data || []).map((product) => ({
            ...product,
            imagem_url: product.imagem_url || null,
            gallery_images: normalizeGallery(product.gallery_images)
        }));
        types = typesResult.data || [];
        renderFilters();
        renderProducts();
    } catch (error) {
        console.error("Erro ao carregar produtos do Imperio Glow:", error);
        showCatalogMessage(
            "Não foi possível carregar os produtos. Verifique a conexão, a chave pública e as permissões de leitura do Supabase.",
            true
        );
    }
}

function subscribeToCatalogChanges() {
    if (!supabaseClient || catalogRealtimeChannel) return;

    catalogRealtimeChannel = supabaseClient
        .channel("imperio-glow-catalog")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "maquiagens" },
            scheduleCatalogRefresh
        )
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "tipos" },
            scheduleCatalogRefresh
        )
        .subscribe((status, error) => {
            if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
                console.error("Não foi possível receber atualizações da vitrine em tempo real:", error || status);
            }
        });
}

function scheduleCatalogRefresh() {
    window.clearTimeout(catalogRefreshTimer);
    catalogRefreshTimer = window.setTimeout(loadCatalog, 150);
}

function openProductDetails(product) {
    previouslyFocusedElement = document.activeElement;
    modalTitle.textContent = product.nome;
    modalPrice.textContent = money(product.preco);
    modalDescription.textContent = product.informacoes || "Não há informações adicionais para este produto.";

    modalPhotoUrls = productPhotoUrls(product);
    modalGalleryThumbnails.replaceChildren();
    modalPhotoUrls.forEach((url, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "modal-gallery-thumbnail";
        button.dataset.photoIndex = String(index);
        button.setAttribute("aria-label", `Exibir foto ${index + 1} de ${modalPhotoUrls.length}`);
        button.setAttribute("aria-pressed", String(index === 0));
        if (index === 0) button.classList.add("active");

        const thumbnail = document.createElement("img");
        thumbnail.src = url;
        thumbnail.alt = "";
        thumbnail.loading = "lazy";
        button.append(thumbnail);
        modalGalleryThumbnails.append(button);
    });
    modalGalleryThumbnails.classList.toggle("hidden", modalPhotoUrls.length < 2);
    showModalPhoto(0, product.nome);

    const whatsappUrl = makeWhatsAppUrl(product);
    modalContact.href = whatsappUrl || "#";
    modalContact.setAttribute("aria-disabled", String(!whatsappUrl));

    itemModal.classList.add("open");
    itemModal.setAttribute("aria-hidden", "false");
    modalClose.focus();
}

function showModalPhoto(index, productName = modalTitle.textContent) {
    const url = modalPhotoUrls[index];
    modalImage.onerror = null;
    modalImage.classList.toggle("hidden", !url);
    modalArt.classList.toggle("has-image", Boolean(url));

    if (!url) {
        modalImage.removeAttribute("src");
        modalImage.alt = "";
    } else {
        modalImage.src = url;
        modalImage.alt = `Foto ${index + 1} de ${productName}`;
        modalImage.onerror = () => {
            modalImage.classList.add("hidden");
            modalArt.classList.remove("has-image");
        };
    }

    modalGalleryThumbnails.querySelectorAll(".modal-gallery-thumbnail").forEach((button) => {
        const isActive = Number(button.dataset.photoIndex) === index;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
    });
}

function closeModal() {
    if (!itemModal.classList.contains("open")) return;
    itemModal.classList.remove("open");
    itemModal.setAttribute("aria-hidden", "true");
    if (previouslyFocusedElement instanceof HTMLElement) {
        previouslyFocusedElement.focus();
    }
}

filtersContainer.addEventListener("click", (event) => {
    const button = event.target.closest(".filter[data-filter]");
    if (!button) return;

    activeFilterId = button.dataset.filter;
    filtersContainer.querySelectorAll(".filter").forEach((filter) => {
        filter.classList.toggle("active", filter === button);
    });
    renderProducts();
});

modalClose.addEventListener("click", closeModal);
modalGalleryThumbnails.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-photo-index]");
    if (!button) return;
    showModalPhoto(Number(button.dataset.photoIndex));
});
itemModal.addEventListener("click", (event) => {
    if (event.target.getAttribute("data-close") === "true") closeModal();
});

window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
    if (event.key !== "Tab" || !itemModal.classList.contains("open")) return;

    const focusable = [...modalCard.querySelectorAll(
        'a[href]:not([aria-disabled="true"]), button:not([disabled])'
    )];
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
});

loadCatalog();
subscribeToCatalogChanges();
