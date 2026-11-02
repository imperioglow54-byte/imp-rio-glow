DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication
        WHERE pubname = 'supabase_realtime'
    ) THEN
        RAISE EXCEPTION 'A publicação supabase_realtime não existe neste projeto.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'maquiagens'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.maquiagens;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'tipos'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.tipos;
    END IF;
END
$$;
