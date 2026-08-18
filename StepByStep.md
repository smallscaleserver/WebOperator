# WebOperator — Step-by-Step Local Run Guide

คู่มือนี้สำหรับรัน WebOperator บนเครื่อง local ให้เข้าใช้งานได้ที่
`http://localhost:4000` และทดสอบ XC Bank monitor/live view ได้เอง
ทีละขั้นตอนบน Windows/PowerShell.

ถ้าต้องการใช้ฟีเจอร์ Recorder (record→analyze→run — บันทึกการคลิก/พิมพ์
บนเว็บจริงแล้วเซฟรันซ้ำได้ ใช้ได้กับ lane ไหนก็ได้) ดู
[`UniversalRecorderUsage.md`](./UniversalRecorderUsage.md) แทน — คู่มือ
นี้ครอบคลุมแค่การเปิดระบบพื้นฐาน/ทดสอบ XC Bank เท่านั้น.

## AuthBridge mock overlay runtime test

Use this flow to verify the mock-first AuthBridge integration added in
`ff99453 Add mock AuthBridge queue integration`. The AuthBridge source
repo is expected beside this repo at `D:\WebOperatorAuthBridge`.

This flow is mock-only:

- WebOperator sends only `credentialRef: scb.mock.demo` to AuthBridge.
- WebOperator must not receive, store, or log plaintext passwords.
- Do not run `/secrets/set` from WebOperator.
- Do not use this flow for real SCB login.
- Do not automate OTP, 2FA, CAPTCHA, or passkey steps.

From `D:\WebOperator`, start the WebOperator stack with the AuthBridge
overlay:

```powershell
docker compose -f docker-compose.yml -f ../WebOperatorAuthBridge/weboperator-compose.overlay.example.yml up -d --build scb-mock browser-worker-scb-business-anywhere-1 auth-bridge redis minio
```

Start the Control Panel API and queue worker in separate terminals:

```powershell
cd services/control-panel
npm start
```

```powershell
cd services/control-panel
npm run worker
```

Open the SCB live page:

```text
http://localhost:4000/monitors/scb-business-anywhere/live
```

Use the **AuthBridge mock test** section:

- **Queue AuthBridge State** enqueues a BullMQ job that calls
  AuthBridge `/auth/state`; on the mock login page it should report
  `needs_username`.
- **Queue Mock Login** enqueues a BullMQ job that calls AuthBridge
  `/auth/login` with `credentialRef: scb.mock.demo`; against
  `scb-mock` it should finish as `authenticated`.

The browser UI never calls AuthBridge directly. It calls the Control
Panel route, which enqueues BullMQ work, and the worker calls
AuthBridge.

Cleanup AuthBridge only when you are done with the overlay test:

```powershell
docker compose -f docker-compose.yml -f ../WebOperatorAuthBridge/weboperator-compose.overlay.example.yml stop auth-bridge
docker compose -f docker-compose.yml -f ../WebOperatorAuthBridge/weboperator-compose.overlay.example.yml rm -f auth-bridge
```

Avoid `docker compose down` unless you intentionally want to stop the
entire WebOperator stack.
## 0. สิ่งที่ต้องมีก่อน

- เปิด **Docker Desktop** ให้พร้อมใช้งาน
- มี **Node.js + npm**
- อยู่ที่ repo นี้: `D:\WebOperator`

เช็ค Docker:

```powershell
cd D:\WebOperator
docker ps
```

ถ้า Docker พร้อม คำสั่งควรตอบตาราง container ได้ แม้จะว่างก็ตาม
ถ้าขึ้นว่า connect Docker API ไม่ได้ ให้เปิด Docker Desktop ก่อน

## 1. เตรียม env ครั้งแรก

ถ้ามี `.env` อยู่แล้ว ข้ามขั้นนี้ได้

```powershell
cd D:\WebOperator
copy .env.example .env
```

รหัส noVNC ดูได้จาก:

```powershell
Get-Content .env
```

หา `VNC_PASSWORD=...` แล้วใช้ค่านั้นตอน noVNC ถาม password

## 2. เปิด Docker services หลัก

```powershell
cd D:\WebOperator
docker compose up -d redis minio xc-bank browser-worker-chrome
```

ถ้าจะลอง Firefox ด้วย:

```powershell
docker compose up -d browser-worker-firefox
```

เช็คสถานะ:

```powershell
docker compose ps
```

ควรเห็นอย่างน้อย 4 services เป็น `running`:

- `redis`
- `minio`
- `xc-bank`
- `browser-worker-chrome`

## 3. เปิด Control Panel API/UI

เปิด PowerShell หน้าต่างที่ 1 แล้วรัน:

```powershell
cd D:\WebOperator\services\control-panel
npm install
npm start
```

ปล่อย terminal นี้ค้างไว้ ถ้าสำเร็จจะเห็น:

```text
WebOperator Control Panel: http://localhost:4000
Bound to 127.0.0.1 only — no auth, do not expose this to a network.
Job queue consumer runs separately -- start it with "npm run worker".
```

## 4. เปิด Queue Worker

เปิด PowerShell หน้าต่างที่ 2 แล้วรัน:

```powershell
cd D:\WebOperator\services\control-panel
npm run worker
```

ปล่อย terminal นี้ค้างไว้เหมือนกัน หน้านี้เป็นตัวรับงานจาก queue แล้วสั่ง
Docker/Playwright worker ให้ทำงานจริง

> สำคัญ: อย่ารัน `npm start` หรือ `npm run worker` จาก `D:\WebOperator`
> เพราะ root repo ไม่มี `package.json`; ต้องรันจาก
> `D:\WebOperator\services\control-panel` เท่านั้น

## 5. เปิดหน้าเว็บหลัก

เปิด browser บนเครื่องคุณ:

```text
http://localhost:4000/
```

หน้านี้คือ **Control Center** สำหรับ:

- Start/Stop browser worker
- Take control ผ่าน noVNC
- Run workflows
- ดู jobs/steps/screenshots
- เข้า monitor pages

**ตรวจ readiness ก่อนทดสอบ**: ก่อนกด workflow หรือ monitor ใด ๆ ให้ดู
หัวข้อ **System Health** บนสุดของหน้า — ควรเห็นแถบเขียว "✅ All systems
ready" กด **Run readiness check** เพื่อเช็คซ้ำได้ทันที หรือกด
**Diagnostics →** เพื่อดูรายละเอียดทีละ service ที่
<http://localhost:4000/health> (Docker services 4 ตัว, Control Panel
API, queue worker, Redis, MinIO, XC Bank URL, noVNC/Chrome) ถ้าแถบขึ้น
สีแดง "N issue(s)" หน้า Diagnostics จะบอกคำสั่งที่ควรรันแก้ตรง ๆ เช่น
`docker compose up -d redis` — **หน้านี้ไม่ auto-start อะไรให้เองทั้งสิ้น
ต้องรันคำสั่งเองเสมอ**

## 6. ทดสอบ Take Control

ที่ `http://localhost:4000/`:

1. ดูแถว **Chrome** ต้องเป็น `running`
2. กด **Take control**
3. ถ้า noVNC ถาม password ให้ใส่ค่า `VNC_PASSWORD` จาก `.env`
4. ควรเห็น desktop/Chromium จริงในหน้าเว็บ

ถ้าจะเปิด noVNC ตรง:

```text
http://localhost:6080/vnc.html
```

## 7. ทดสอบ XC Bank workflow

ที่ `http://localhost:4000/`:

1. ไปที่ section **Workflows**
2. กด `Run "xc-bank-login-extract"`
3. ดูตาราง **Jobs**
4. คลิกแถว job เพื่อ expand
5. ควรเห็น steps ตามชื่อจริง (ยืนยันด้วยการรันจริงผ่าน queue แล้ว ไม่ใช่
   ชื่อ action ทั่วไปแบบ "login"/"extract"): `validate`, `connect`,
   `1-xcBankLogin`, `2-xcBankExtractDashboard`, `3-screenshot`,
   `3-archive-screenshot`
6. กดลิงก์ screenshot หรือ MinIO artifact ของ step `3-screenshot` เพื่อ
   ตรวจภาพ

XC Bank mock site เปิดตรงได้ที่:

```text
http://localhost:4100/login
```

## 8. ทดสอบ XC Bank History/Detail Monitor

เปิด:

```text
http://localhost:4000/monitors/xc-bank
```

หน้านี้ใช้ดูประวัติ:

- สถานะ monitor
- latest balance
- transaction history
- notifications history
- screenshot timeline สูงสุด 200 รูปล่าสุด

ลองกด:

- **Check once** เพื่อให้ bot ตรวจ 1 รอบ
- **Start** เพื่อให้ bot loop ตรวจต่อเนื่อง — ก่อนกด ลองใส่ตัวเลขในช่อง
  "Run for ___ min" (1-240) ถ้าอยากให้ bot หยุดเองอัตโนมัติหลังจากผ่านไป
  N นาที (ป้องกัน loop ค้างรันนานเกินไปโดยไม่มีคนดูแล) — เว้นว่างไว้ =
  รันไม่จำกัดเวลา เหมือนเดิม ระหว่างรันจะเห็นข้อความ "Auto-stop:
  ~HH:MM:SS"; หลัง auto-stop ทำงานจะเห็น "⏱ Auto-stopped after N
  minute(s)"
- **Stop** เพื่อหยุด loop

## 9. ทดสอบ XC Bank Live View

เปิด:

```text
http://localhost:4000/monitors/xc-bank/live
```

หน้า live view แบ่งเป็น 2 ฝั่ง:

- ซ้าย: browser สดผ่าน noVNC หรือ fallback screenshot ล่าสุด
- ขวา: status, last checked, balance, notifications, transactions,
  Start/Stop/Check once

วิธีลอง:

1. เปิด `http://localhost:4000/monitors/xc-bank/live`
2. ถ้า noVNC ถาม password ให้ใส่ `VNC_PASSWORD`
3. กด **Check once** ที่ panel ขวา
4. รอ job ทำงานประมาณไม่กี่วินาที
5. ดูว่า `last checked`, balance, notifications, transactions เปลี่ยน
6. ถ้ากด **Start** monitor จะตรวจวนเป็นระยะ

## 10. ทดสอบ Logout Clean แล้ว fresh login ใหม่

ที่ `http://localhost:4000/`:

1. ไปที่ **Workflows**
2. กด `Run "xc-bank-logout-clean"`
3. รอ job completed
4. กด `Run "xc-bank-login-extract"` อีกครั้ง
5. รอบนี้ adapter ควรผ่าน fresh login flow ที่ต้องใส่ username ใหม่

## 11. MinIO Console

เปิด:

```text
http://localhost:9001
```

ใช้ user/password จาก `.env` ถ้ามีบรรทัด `MINIO_ROOT_USER`/
`MINIO_ROOT_PASSWORD` อยู่จริง — แต่ `.env` ที่สร้างไว้ตั้งแต่ก่อนมี MinIO
(เช่นมีแค่ `VNC_PASSWORD` บรรทัดเดียว) จะไม่มีสองบรรทัดนี้เลย ในกรณีนั้น
`docker-compose.yml` จะ fallback ไปใช้ค่า default แทน (ยืนยันด้วยการ login
เข้า MinIO จริงแล้ว ไม่ใช่แค่อ่านจากไฟล์):

```env
MINIO_ROOT_USER=weboperator
MINIO_ROOT_PASSWORD=changeme123
```

ถ้าคุณเคยตั้งค่าเองใน `.env` ให้ใช้ค่าที่ตั้งไว้แทนค่า default ด้านบน

ดู bucket artifact ได้ เช่น screenshots/session archives ที่เป็น dev-only

## 12. ปิดระบบเมื่อทดสอบเสร็จ

1. ไปที่ PowerShell หน้าต่าง `npm start` แล้วกด `Ctrl+C`
2. ไปที่ PowerShell หน้าต่าง `npm run worker` แล้วกด `Ctrl+C`
3. ปิด Docker services:

```powershell
cd D:\WebOperator
docker compose down
```

เช็คว่าไม่มี container ค้าง:

```powershell
docker ps
```

## Troubleshooting

### `npm error enoent Could not read package.json`

แปลว่ารัน npm ผิดโฟลเดอร์ ให้เข้า control panel ก่อน:

```powershell
cd D:\WebOperator\services\control-panel
npm start
```

หรือ:

```powershell
cd D:\WebOperator\services\control-panel
npm run worker
```

### Docker services หายหลัง Docker Desktop restart

ถ้า `docker ps -a` ว่าง แต่ `npm start`/`npm run worker` ยังรันอยู่ ให้เปิด
Docker services กลับมาใหม่ได้เลย:

```powershell
cd D:\WebOperator
docker compose up -d redis minio xc-bank browser-worker-chrome
```

Control Panel และ queue worker มัก reconnect ได้เอง ถ้ายังไม่หาย ให้กด
`Ctrl+C` แล้วเริ่ม `npm start`/`npm run worker` ใหม่

### Port 4000 ค้าง

หา PID:

```powershell
Get-NetTCPConnection -LocalPort 4000 -State Listen | Select-Object -ExpandProperty OwningProcess
```

ปิด process:

```powershell
Stop-Process -Id <PID> -Force
```

### Queue worker ค้างแต่ไม่ฟัง port

หา process จาก command line:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*services/control-panel*' -and $_.CommandLine -like '*worker*' } | Select-Object ProcessId,CommandLine
```

ปิด process:

```powershell
Stop-Process -Id <PID> -Force
```

### noVNC ถาม password

ดูจาก `.env`:

```powershell
cd D:\WebOperator
Get-Content .env
```

ใช้ค่าหลัง `VNC_PASSWORD=`

### แก้ dependency worker แล้ว Docker ยังใช้ของเก่า

ถ้าแก้ `services/worker/package.json` ต้อง rebuild image:

```powershell
cd D:\WebOperator
docker compose build worker
```

ถ้าเกี่ยวกับ Firefox worker:

```powershell
docker compose build worker-firefox
```

