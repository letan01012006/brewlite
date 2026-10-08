# BrewLite

Ứng dụng đặt cà phê không dùng tiền mặt. NestJS + Next.js + PostgreSQL (Prisma).

## Yêu cầu
Node.js 24.15+ (hoặc 26), Git, Docker Desktop.

## Chạy dự án
```bash
docker compose up -d

cd backend
cp .env.example .env
npm install
npm run start:dev      # http://localhost:4000/api/docs

# terminal khác
cd frontend
cp .env.example .env.local
npm install
npm run dev            # http://localhost:3000
```

## Quy ước
- Nhánh: `main` ← `develop` ← `feature/task-x-ten`. Không push thẳng `main`, `develop`.
- Commit: `feat:`, `fix:`, `docs:`, `chore:`.
- Mọi thay đổi qua Pull Request, cần 1 người review.