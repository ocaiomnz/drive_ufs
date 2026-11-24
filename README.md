# UFS DRIVE

Armazenamento de arquivos no estilo Google Drive: upload assinado, pastas por usuário, PWA, e **portas de sync** que espelham cada arquivo no Google Drive, Dropbox, S3/R2 ou webhook — além do disco (ou R2) do provedor.

Derivado da arquitetura do CasaNenos, sem identidade de casamento.

## Stack

- Node.js + Express + EJS
- MySQL
- Storage principal: `disk` ou `r2`
- Portas: `gdrive` · `dropbox` · `s3` · `webhook`
- PM2 + Nginx (deploy)

## Setup local

```bash
cp .env.example .env
# MySQL, STORAGE_DIR, UPLOAD_SECRET, ADMIN_PASSWORD

npm install
npm run db:init
npm start
```

- Landpage: http://localhost:3000  
- Drive: http://localhost:3000/drive  
- Admin + portas: http://localhost:3000/admin  

Docker: `docker compose up --build -d` → http://localhost:3001 (admin: `admin2026`).

## Fluxo de upload

1. Cliente pede `POST /api/upload-url`
2. `PUT` do arquivo (e miniatura, se imagem) na URL assinada
3. `POST /api/files` confirma no MySQL
4. Em segundo plano, cada **porta ativa** recebe uma cópia (`sync_jobs`)

## Portas de sync

Em `/admin`, cadastre uma porta com JSON de credenciais:

| Provedor | Campos principais |
|----------|-------------------|
| `gdrive` | `clientId`, `clientSecret`, `refreshToken` **ou** `serviceAccountJson`; `folderId` opcional |
| `dropbox` | `accessToken`; `folderPath` opcional (`/UFS Drive`) |
| `s3` | `accessKeyId`, `secretAccessKey`, `bucket`; `endpoint`/`prefix` opcionais |
| `webhook` | `url`; `headers` / `fieldName` opcionais |

O storage principal continua sendo o disco/R2 do provedor. As portas são espelho mútuo — se uma falhar, o arquivo no provedor permanece e o job fica com `status=error`.

## Estrutura no disco

```
/var/ufs-drive/files/
  uploads/<dono>/<uuid>-<arquivo>
  thumbs/<dono>/<uuid>-<arquivo>.jpg
  .incoming/
```

## Deploy (PM2)

```bash
sudo mkdir -p /var/ufs-drive/files && sudo chown $USER /var/ufs-drive/files
pm2 start ecosystem.config.js
pm2 save
```

Nginx: veja `deploy/nginx.example.conf`.
