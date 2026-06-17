
update notification_channels set enabled=true, config='{"from":"INWISE <noreply@inwisepro.com>"}'::jsonb where id='email';
update notification_channels set enabled=true, config='{"from_number":"+14155238886"}'::jsonb where id='whatsapp';
update notification_channels set enabled=false where id='sms';
update notification_events set channels='{email,whatsapp}', notify_admin=true, notify_customer=false
  where id in ('new_order','order_status','new_customer','account_approved','low_stock');
insert into notification_recipients (label, email, whatsapp, phone, active)
  values ('Teste','clovisjunior@live.com','+15618498555','+15618498555',true);
