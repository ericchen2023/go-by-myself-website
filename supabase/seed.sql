-- Local and ephemeral-test seed only. Hosted staging provisions its own scoped
-- robot identity and operator accounts through audited environment setup.
update public.vehicles
set operational_status = 'available',
    active = true,
    current_stop_code = 'HSS1',
    home_stop_code = 'HSS1',
    capabilities = '{"syntheticCompartment":true,"telemetryV2":true}'::jsonb,
    route_validation_enabled = false,
    updated_at = now()
where code = 'GBM-01';
