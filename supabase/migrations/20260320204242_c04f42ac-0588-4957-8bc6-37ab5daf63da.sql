
-- Migrate products from duplicate categories (no b2bwave_id) to real ones
UPDATE produtos SET categoria_id = 'b64bc1ba-a959-4915-8d72-4b31080de1c3' WHERE categoria_id = 'e628c153-ed5d-4446-a9b9-87e2a46dd263';
UPDATE produtos SET categoria_id = '0364d87a-4411-42d9-bd9a-c6ecc1eb075c' WHERE categoria_id = '7d90b026-2c2c-4424-919c-9ab25cb28e3f';
UPDATE produtos SET categoria_id = 'de6df128-e977-494f-837c-686ebb83468e' WHERE categoria_id = '0e03d12a-952b-4429-b873-c5abddae4ba0';
UPDATE produtos SET categoria_id = '158741db-5db1-4238-a227-bea8ccf7526f' WHERE categoria_id = 'e25e37ec-bc0c-4769-acc6-cd29c963256d';
UPDATE produtos SET categoria_id = '82dd1ff4-8ede-428e-a6d3-e8128f130a39' WHERE categoria_id = 'dd67b5eb-143d-43f0-a42e-6bc0b99401fc';
UPDATE produtos SET categoria_id = '1fb949e1-24fc-44b2-a938-c9d32e3adabe' WHERE categoria_id = '08017d52-067e-4586-b209-fc4cb5606d53';
UPDATE produtos SET categoria_id = '80f1a479-73d0-4c99-9ee0-5c473e6a9c6b' WHERE categoria_id = 'e1da90b2-f135-4d50-bf21-6d5a80172fc7';
UPDATE produtos SET categoria_id = 'cc11e2ae-9fb7-4c3c-9021-a3abb0feab2a' WHERE categoria_id = 'ca0caa3a-7ffc-4c17-b3b5-480b17776574';
UPDATE produtos SET categoria_id = '64018a19-06e8-4adb-882f-bebdc91600e5' WHERE categoria_id = '1b1c5cc7-4e32-4c3a-b438-1660a1e9bbf5';
UPDATE produtos SET categoria_id = 'bdc0fb43-185e-4992-b4ce-2ef0d719ef83' WHERE categoria_id = '1a182201-fe77-4a3f-b7ac-6637e5e5b453';
UPDATE produtos SET categoria_id = 'fb5cb736-e9e7-448f-ae34-0613ff71a02b' WHERE categoria_id = 'd6a86893-4cb6-4e89-9ac2-49696042e78b';
UPDATE produtos SET categoria_id = 'a7ccc28b-752f-435f-84d9-2fee6f7440bd' WHERE categoria_id = '9bed8244-ce42-4178-9608-87097c8ccbf9';
UPDATE produtos SET categoria_id = 'e9599ee3-1f9a-424f-af35-a62f2011020a' WHERE categoria_id = 'd54ef4d9-ec90-42c3-bf44-d718dd061dc0';
UPDATE produtos SET categoria_id = 'e9370a22-aec2-4fb9-8fe3-f067222935a9' WHERE categoria_id = 'b205903e-d8b4-4cdf-a75a-96b04fcb77c6';
UPDATE produtos SET categoria_id = '84038e8d-d479-489f-8bcf-d78a177c952b' WHERE categoria_id = '4930b5b2-512e-4f1a-ba98-3175f9606e06';
UPDATE produtos SET categoria_id = '801cf1a9-8f9b-4edf-a369-f3e9af1d4263' WHERE categoria_id = 'b941d2c7-4842-44fb-80e3-895c06ffcaf9';
UPDATE produtos SET categoria_id = '419f5380-d47f-42fb-bb6f-7ad53ba81881' WHERE categoria_id = '778bcf6e-c2f0-402d-a2cb-db029b9fa62c';
UPDATE produtos SET categoria_id = '87dc4ea6-69ed-4d54-bf7c-4c19c8f6cf70' WHERE categoria_id = 'eae8fa1a-2f5d-40ac-b75b-40ac84172741';
UPDATE produtos SET categoria_id = 'a972e2a9-ae8c-4ae5-9747-675a737b965d' WHERE categoria_id = 'c44deddc-be86-4050-b789-a3fd685df3f7';
UPDATE produtos SET categoria_id = 'a72a6044-5e72-43d7-8b30-55375b4ec79f' WHERE categoria_id = '600e7a5f-341f-4c15-9687-4b8b263df0d9';
UPDATE produtos SET categoria_id = '88b70697-3954-4843-a7fc-3aa5d4b1e97a' WHERE categoria_id = 'e723cdcd-2ae8-4c2a-9c10-83334015a1c1';
UPDATE produtos SET categoria_id = '9deabfbf-0cd7-4815-9d6a-e7c223014e83' WHERE categoria_id = 'e7e896c7-dc93-473a-806c-bc9559683b68';
UPDATE produtos SET categoria_id = '29eea6cf-d2aa-4f83-b209-0afa38513e8f' WHERE categoria_id = '487a6654-3dd8-4c17-b509-2bd2d6d44648';
UPDATE produtos SET categoria_id = '7ad9ae09-4063-447d-a1d0-6dcfdeb1c726' WHERE categoria_id = 'bb75caef-5bff-4488-b909-f08cc13e0bec';
UPDATE produtos SET categoria_id = '9a766e3b-d111-4978-b5d6-c112fb1c072e' WHERE categoria_id = 'bf51eb41-c333-4642-b306-6bd00c340c3a';
UPDATE produtos SET categoria_id = 'bc8e0987-bc22-452d-a4d2-33576a75b589' WHERE categoria_id = 'a68086e9-1812-4016-9fc8-4c44b179a2e9';
UPDATE produtos SET categoria_id = 'e268e038-1828-4e7a-9d5a-ee53752675fd' WHERE categoria_id = '3b9ec00c-cfc7-4412-be05-86fa884fae5c';
UPDATE produtos SET categoria_id = 'cfba433a-a8a7-4f7c-98fc-50f42a1813a7' WHERE categoria_id = '5775f8d8-da74-430e-b0f8-e4781adca0a2';
UPDATE produtos SET categoria_id = '6c6b2ff2-d23b-45b3-8f09-1409cb6e551f' WHERE categoria_id = 'da798f21-ccb7-4c5a-8055-f8975b400a47';

-- Deactivate all duplicate categories (those without b2bwave_id)
UPDATE categorias SET ativo = false WHERE b2bwave_id IS NULL AND ativo = true;
