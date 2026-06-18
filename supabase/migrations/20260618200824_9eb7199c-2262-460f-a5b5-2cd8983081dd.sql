select public._schedule_b2bwave_job('b2bwave-cron-orders',     '*/15 * * * *',    'cron_orders');
select public._schedule_b2bwave_job('b2bwave-cron-customers',  '5-59/15 * * * *', 'sync_customers');
select public._schedule_b2bwave_job('b2bwave-cron-products',   '10 * * * *',      'sync_products');
select public._schedule_b2bwave_job('b2bwave-cron-pricelists', '20 * * * *',      'sync_price_lists');