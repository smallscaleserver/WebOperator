# WebOperator — Clean All & Rebuild Guide

คู่มือนี้สำหรับ "ล้างของเก่าทั้งหมดแล้วสร้างใหม่" — ใช้เมื่อสงสัยว่า image
เก่าค้าง, ดิสก์เต็ม, หรืออยากเทสต์ว่า setup จากศูนย์ (ตาม
[`StepByStep.md`](./StepByStep.md)) ยังใช้งานได้จริงอยู่ ไม่ใช่ขั้นตอนที่
ต้องทำเป็นประจำ — งานปกติแค่ `docker compose down` ตอนเลิกใช้ก็พอ (ดู
[`StepByStep.md`](./StepByStep.md) ข้อ 12)

**คำเตือน**: ทุกคำสั่งในไฟล์นี้ทำลายของเดิม (image, container, และถ้าเลือก
ทำข้อ 3 จะรวม local dev data ด้วย) กู้คืนไม่ได้ อย่ารันถ้ามี container อื่น
ที่ยังใช้งานอยู่ในเครื่องเดียวกันโดยไม่ตรวจสอบก่อน และห้ามรันข้ามเครื่อง
production เด็ดขาด (โปรเจกต์นี้เป็น dev/local เท่านั้นอยู่แล้ว แต่เตือนไว้
ให้ชัดเจน)

## 0. หยุดของที่รันอยู่ก่อน

ปิดสอง terminal ที่รัน `npm start`/`npm run worker` (Ctrl+C ทั้งคู่) แล้ว:

```powershell
cd D:\WebOperator
docker compose down
```

เช็คว่า process บน host ปิดจริงด้วย (Windows บางทีค้าง — ดู Troubleshooting
ใน [`StepByStep.md`](./StepByStep.md)):

```powershell
Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*services/control-panel*' -and $_.CommandLine -like '*worker*' }
```

ถ้าเจอ PID ค้าง ปิดด้วย `Stop-Process -Id <PID> -Force`

## 1. ลบ container + image ที่ repo นี้ build เอง (แนะนำก่อน — เบากว่า)

Service ที่ repo นี้ build เอง (มี `build:` ใน `docker-compose.yml`, ไม่ใช่
`image:` ที่ pull มา): `xc-bank`, `browser-worker-chrome`,
`browser-worker-firefox`, `worker`, `worker-firefox`

```powershell
cd D:\WebOperator
docker compose down --rmi local -v --remove-orphans
```

- `--rmi local` ลบเฉพาะ image ที่ compose build เอง (`weboperator-*` ในหน้า
  Docker Desktop) ไม่แตะ `redis:7-alpine`/`minio/minio:latest` ที่ pull มา
- `-v` ลบ named volume ที่ compose สร้าง (repo นี้ไม่มี named volume จริง —
  ใช้ bind mount ใต้ `./data/` ทั้งหมด ซึ่ง `-v` **ไม่แตะ** ไฟล์พวกนี้ ใส่ไว้
  เผื่ออนาคต ปลอดภัยที่จะใส่เสมอ)
- `--remove-orphans` เก็บกวาด container จาก service เก่าที่ลบออกจาก
  `docker-compose.yml` ไปแล้วแต่ยังไม่ถูกล้าง

## 2. ลบ image ที่ pull มาด้วย (ล้างหนักขึ้น — ทำเฉพาะถ้าจำเป็นจริง ๆ)

ใช้ตอนสงสัยว่า image `redis`/`minio` เองก็มีปัญหา หรืออยากรีเฟรชทุกอย่าง
100% รวมของที่ไม่ได้ build เอง:

```powershell
cd D:\WebOperator
docker compose down --rmi all -v --remove-orphans
```

หรือถ้า container ถูกลบไปแล้วจากข้อ 1 และแค่อยากลบ image ที่เหลือ (เช่นลบ
เองผ่าน Docker Desktop ตามรูปตัวอย่าง) ใช้:

```powershell
docker image rm redis:7-alpine minio/minio:latest
```

## 3. (ทางเลือก, ทำลายข้อมูล dev) ล้าง local dev data ด้วย

ทุกอย่างใต้ `data/` เป็น dev-only, gitignored, ไม่มี credential จริง —
session ที่ save ไว้, browser profile, screenshot, monitor state
(`data/monitor-state/xc-bank.json`), ข้อมูลใน MinIO (`data/minio`) ถ้าลบ
จะหายหมดและ MinIO จะ init ใหม่เป็น bucket เปล่า:

```powershell
cd D:\WebOperator
Remove-Item -Recurse -Force data\profiles, data\sessions, data\worker-output, data\minio, data\monitor-state, data\gmail-tokens -ErrorAction SilentlyContinue
```

ข้ามขั้นนี้ได้ถ้าแค่อยากล้าง Docker image/container แต่ยังอยากเก็บ session/
screenshot เดิมไว้

## 4. Build ใหม่ทั้งหมด

`--no-cache` บังคับ build ใหม่จริง ไม่ใช้ layer cache เดิม (ช้ากว่าปกติ —
ใช้ตอนสงสัยว่า cache ทำให้ image เก่าค้างจริง ๆ เท่านั้น ปกติ `docker compose
build` เฉย ๆ ก็พอ):

```powershell
cd D:\WebOperator
docker compose build --no-cache
```

หรือให้ `up -d` build ให้เองพร้อมเริ่ม service เลย (เร็วกว่าถ้าไม่ต้องการ
`--no-cache`):

```powershell
docker compose up -d --build redis minio xc-bank browser-worker-chrome
```

## 5. ตรวจว่าใช้งานได้จริงหลัง build ใหม่

ทำตาม [`StepByStep.md`](./StepByStep.md) ตั้งแต่ข้อ 3 เป็นต้นไป (ข้อ 0-2
ทำไปแล้วในไฟล์นี้) — อย่างน้อยควรยืนยัน:

```powershell
docker compose ps
```

เห็น `redis`, `minio`, `xc-bank`, `browser-worker-chrome` เป็น `running`
ทั้งหมด แล้วเปิด `services/control-panel` สอง terminal
(`npm start`/`npm run worker`) ตามปกติ เปิด <http://localhost:4000> ควร
ใช้งานได้เหมือนเดิมทุกอย่าง — ถ้าไม่ได้ ปัญหาไม่ได้อยู่ที่ image เก่าค้างอีก
ต่อไปแล้ว (เพิ่งสร้างใหม่หมด) ให้ดู Troubleshooting section ใน
[`StepByStep.md`](./StepByStep.md) แทน
