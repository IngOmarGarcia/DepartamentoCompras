-- Se ejecuta al final del arranque: asegura que service_role pueda operar
-- sobre todo lo creado por db/01..04 y refresca el caché de esquema de PostgREST.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

grant select on all tables in schema public to authenticated;
notify pgrst, 'reload schema';
