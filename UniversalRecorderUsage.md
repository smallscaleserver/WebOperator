# Universal Recorder — คู่มือใช้งาน record → analyze → run

คู่มือนี้สรุปวิธีใช้ฟีเจอร์ "Recorder" (บันทึกการคลิก/พิมพ์บนเว็บจริง แล้ว
เซฟเป็นสคริปต์ไว้รันซ้ำได้) ให้ตรงกับโค้ดปัจจุบัน — ใช้ได้กับ **lane ไหน
ก็ได้** ไม่ผูกกับเว็บใดเว็บหนึ่ง (ดูที่มาของการทำให้ universal ใน
`docs/PROJECT_PLAN.md`'s decision log และ `AGENTS.md`)

ไม่มีฟีเจอร์ใหม่ในเอกสารนี้ — สรุปวิธีใช้ของที่มีอยู่แล้วเท่านั้น

## แนวคิดหลัก

- **Lane** = browser instance หนึ่งตัว มี 2 lane ที่มีอยู่ตอนนี้:
  - `shared` — browser กลางที่ใช้ทดสอบทั่วไป (XC Bank, the-internet,
    scb-mock, เว็บอะไรก็ได้) ไม่แยก isolated
  - `scb-business-anywhere-1` — lane แยก isolated เฉพาะบัญชี SCB จริง
    (container/profile/noVNC ของตัวเอง ไม่ share กับ `shared`)
- Recorder ทำงานเหมือนกันทุก lane ผ่าน route เดียวกัน
  `/api/lanes/:laneId/recordings/*` — ไม่มี logic เฉพาะเว็บใดเว็บหนึ่ง
- ขั้นตอนเสมอ: **เปิดเว็บเป้าหมายเอง (ผ่าน noVNC) → Start Recording →
  ทำสิ่งที่ต้องการบนเว็บจริง → Stop Recording → Review → Save → Run/Schedule**

---

## 1. เปิด service ที่ต้องใช้ก่อน

เหมือนขั้นตอนปกติใน `StepByStep.md` — ต้องมีครบ 3 อย่าง:

```powershell
cd D:\WebOperator
docker compose up -d redis minio browser-worker-chrome
# ถ้าจะใช้ SCB lane (จริงหรือ mock) ด้วย:
docker compose up -d browser-worker-scb-business-anywhere-1
# ถ้าจะทดสอบกับ mock แทนบัญชีจริง:
docker compose up -d scb-mock
```

เปิด 2 terminal แยกกัน (ปล่อยค้างไว้ทั้งคู่):

```powershell
# terminal 1
cd D:\WebOperator\services\control-panel
npm start

# terminal 2
cd D:\WebOperator\services\control-panel
npm run worker
```

**สำคัญ**: ถ้า terminal 2 (`npm run worker`) ไม่ได้รัน — job ที่ enqueue
ไว้ (start recording, run script, ฯลฯ) จะค้างอยู่สถานะ `waiting` ตลอดไป
ไม่ error ให้เห็นทันที (ดู Troubleshooting ด้านล่าง)

---

## 2. เลือก lane และเปิดเว็บเป้าหมาย

### lane `shared`

1. เปิด `http://localhost:4000/`
2. กด **Start** ที่แถว Chrome (section "Browsers")
3. กด **Take control** → จะเห็นจอ noVNC ฝังอยู่ในหน้า
4. พิมพ์ URL เว็บเป้าหมายเองในจอ noVNC นั้น (เหมือนใช้ browser ปกติ) แล้ว
   ล็อกอิน/นำทางไปหน้าที่ต้องการด้วยมือ — Recorder ไม่ navigate ให้เอง

> ทางเลือก: ถ้ามี workflow เดิมที่ navigate ไปหน้าที่ต้องการอยู่แล้ว (เช่น
> ทดสอบกับ scb-mock) จะยิง workflow นั้นผ่าน
> `POST /api/enqueue-workflow/:name` ก็ได้ ไม่ต้องพิมพ์เองใน noVNC — แต่
> ชื่อ workflow ที่ขึ้นต้นด้วย `scb-business-anywhere` จะไม่โผล่ใน
> `/api/workflows` เพราะถูกกันไว้ไม่ให้รันกับ `shared` โดยไม่ตั้งใจ

### lane `scb-business-anywhere-1`

1. เปิด `http://localhost:4000/monitors/scb-business-anywhere/live`
2. กด **Start lane**
3. กด **Open Login Page** (นำทางไปหน้า login เปล่า ๆ เท่านั้น ไม่พิมพ์อะไรให้)
4. พิมพ์ username/password/OTP **เองในจอ noVNC** จนกว่าจะล็อกอินสำเร็จ —
   บอทไม่แตะ credential ใด ๆ ทั้งสิ้น
5. กด **I have logged in**

ถ้าต้องการทดสอบกับ **mock** (ปลอดภัย ไม่ใช่บัญชีจริง) แทน — ดู [ตัวอย่าง
flow ทดสอบกับ scb-mock](#ตัวอย่าง-flow-ทดสอบกับ-scb-mock) ด้านล่าง

---

## 3. วิธีที่ 1 — ใช้ผ่านหน้าเว็บ Control Panel (UI)

ทั้งหน้า `/` (lane `shared`) และหน้า SCB live page (lane
`scb-business-anywhere-1`) มี Recorder section หน้าตาเดียวกัน (มาจาก
component เดียวกันคือ `recorder-ui.js`) ใช้งานเหมือนกันทุกขั้นตอน:

1. **Start Recording** — กดปุ่ม 🔴 Start Recording (ต้องผ่านหน้า
   login/credential ไปแล้วก่อน ไม่งั้นจะถูก refuse — ดูหัวข้อ 6)
2. **ระหว่างอัด** — สลับไปทำสิ่งที่ต้องการในจอ noVNC เดียวกัน (คลิก,
   พิมพ์ข้อความปกติ) — สูงสุด 15 นาทีต่อ session
3. **Stop Recording** — กด ⏹ Stop Recording เมื่อทำครบแล้ว
4. **Review captured steps** — รายการ step ที่บันทึกได้จะขึ้นอัตโนมัติ
   พร้อมบอกจำนวน credential field ที่ถูก redact (ถ้ามี)
5. **Save as script** — ตั้งชื่อ (ใช้ได้แค่ตัวอักษร/ตัวเลข/`-`/`_`) แล้ว
   กด 💾 Save as script
6. **Run now** — กดปุ่ม ▶ ข้างชื่อสคริปต์ที่เซฟไว้ใน list ด้านล่าง เพื่อรันซ้ำ
7. **Schedule** — ใส่ตัวเลขนาที (1–1440) ในช่อง "every N min" แล้วกด
   **Start schedule** เพื่อให้รันซ้ำอัตโนมัติ, กด **Stop schedule** เพื่อ
   หยุด
8. **Delete** — กด 🗑 เพื่อลบสคริปต์ (จะหยุด schedule ของมันให้อัตโนมัติด้วย)

ถ้ามี step ที่เป็น "risky" (ดูหัวข้อ 7) ระหว่างรัน จะมี banner สีเหลือง
ขึ้นบนหน้าบอกว่ากำลังรอ `/confirm` ทาง Telegram

---

## 4. วิธีที่ 2 — ใช้ผ่าน API/curl

ทุก route ขึ้นต้นด้วย `/api/lanes/:laneId/recordings/...` โดย `:laneId`
คือ `shared` หรือ `scb-business-anywhere-1` — ถ้าใส่ lane ผิด/ไม่มีจริง
จะได้ `404` พร้อม `{"ok":false,"error":"Unknown lane \"...\""}` ทันที
ไม่มี fallback ไป `shared` เงียบ ๆ

### Start recording

```bash
curl -s -X POST http://localhost:4000/api/lanes/shared/recordings/start
# => {"ok":true,"runId":"<uuid>","jobId":"<jobId>"}
```

เก็บ `runId` ไว้ใช้ตอน stop

### (ระหว่างนี้ทำสิ่งที่ต้องการในจอ noVNC ด้วยมือ)

### Stop recording

```bash
curl -s -X POST http://localhost:4000/api/lanes/shared/recordings/stop \
  -H "Content-Type: application/json" \
  -d '{"runId":"<uuid จากขั้นก่อนหน้า>"}'
```

### ดูผลลัพธ์การอัด (review)

Job ของการอัดจะ "completed" หลังจากสั่ง stop สำเร็จ — เช็คผ่าน
`GET /api/jobs` แล้วมองหา `jobId` ที่ได้จากขั้น start:

```bash
curl -s http://localhost:4000/api/jobs | node -e '
let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
  const j = JSON.parse(d).jobs.find(j=>j.id==="<jobId>");
  console.log(j.result.stdout.split("\n").find(l=>l.startsWith("SCB_RECORDING_RESULT")));
});'
```

บรรทัดที่ขึ้นต้นด้วย `SCB_RECORDING_RESULT` คือ JSON ของ
`{"steps":[...], "redactedCount":N, "eventCount":N}` — นี่คือผลลัพธ์ที่
UI เอาไปแสดงในหน้า "Review captured steps"

### Save เป็นสคริปต์

```bash
curl -s -X POST http://localhost:4000/api/lanes/shared/recordings/save \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-script-name",
    "steps": [ /* array ของ steps จาก SCB_RECORDING_RESULT ด้านบน */ ]
  }'
```

### ดูรายชื่อสคริปต์ที่เซฟไว้

```bash
curl -s http://localhost:4000/api/lanes/shared/recordings
# => {"ok":true,"recordings":["my-script-name", ...]}
```

### รันสคริปต์ที่เซฟไว้

```bash
curl -s -X POST http://localhost:4000/api/lanes/shared/recordings/my-script-name/run
# => {"ok":true,"jobId":"..."}
```

ตามด้วย poll `GET /api/jobs` เพื่อดูผล เหมือนขั้นตอน review ด้านบน

### Schedule ให้รันซ้ำ

```bash
# เริ่ม schedule ทุก 30 นาที
curl -s -X POST http://localhost:4000/api/lanes/shared/recordings/my-script-name/schedule/start \
  -H "Content-Type: application/json" \
  -d '{"everyMinutes": 30}'

# เช็คสถานะ
curl -s http://localhost:4000/api/lanes/shared/recordings/my-script-name/schedule

# หยุด schedule
curl -s -X POST http://localhost:4000/api/lanes/shared/recordings/my-script-name/schedule/stop
```

### ลบสคริปต์

```bash
curl -s -X DELETE http://localhost:4000/api/lanes/shared/recordings/my-script-name
```

### เช็ค pending confirmation (ดูว่ากำลังรอ /confirm อยู่ไหม)

```bash
curl -s http://localhost:4000/api/lanes/shared/replay-state
```

---

## 5. วิธีที่ 3 — Telegram command

ต้องตั้งค่า `TELEGRAM_BOT_TOKEN_XC`/`TELEGRAM_CHAT_ID_XC` ใน `.env` ไว้
ก่อน (ดู `StepByStep.md`) คำสั่งที่มี:

| คำสั่ง | ทำอะไร |
| --- | --- |
| `/run <name>` | รันสคริปต์ที่เซฟไว้ — ค้นหาชื่อนี้ในทุก lane อัตโนมัติ ไม่ต้องระบุ lane |
| `/confirm` | อนุมัติ step ที่กำลังหยุดรอ (risky step) |
| `/cancel` | ปฏิเสธ/ยกเลิก step ที่กำลังหยุดรอ |
| `/status` | (เฉพาะ SCB lane) ยอดเงิน+รายการล่าสุดจากหน้าปัจจุบัน — read-only |
| `/screenshot` | (เฉพาะ SCB lane) screenshot หน้าปัจจุบัน — read-only |
| `/help` | แสดงรายการคำสั่งทั้งหมด |

`/run` ไม่ต้องใส่ชื่อ lane — ถ้าชื่อสคริปต์นั้นถูกเซฟไว้ **มากกว่า 1
lane พร้อมกัน** (เกิดได้เฉพาะถ้าตั้งชื่อซ้ำกันเองข้าม lane) บอทจะ
**ปฏิเสธและบอกชื่อ lane ทั้งหมดที่เจอ** ให้ไปลบ/เปลี่ยนชื่ออันใดอันหนึ่ง
เอง — ไม่เลือกรันให้เองเด็ดขาด

**ข้อจำกัดตายตัว**: `/run` รันได้แค่สคริปต์ที่เคยอัด-review-เซฟเองไว้แล้ว
เท่านั้น ไม่มีทางพิมพ์/คลิก/navigate จาก text ที่พิมพ์เข้ามาตรง ๆ ทาง
Telegram ได้

---

## 6. ระหว่างอัด (Recording) — ทำ/ห้ามทำอะไร

**ทำได้**:
- คลิกปุ่ม/ลิงก์ปกติ
- พิมพ์ข้อความในช่อง input ปกติ (ที่ไม่ใช่ credential — ดูหัวข้อ 8)
- กด Enter/Tab เพื่อย้ายระหว่าง field

**ห้ามทำ / ระวัง**:
- **อย่าเริ่ม recording ขณะยังอยู่หน้า login/credential** — ระบบจะ
  refuse ทันที (ดูหัวข้อ 8)
- **อย่าปิด/รีเฟรช tab ที่กำลังอัดอยู่** — recorder สังเกตหน้าที่เปิดอยู่
  เท่านั้น ไม่ได้ผูกกับ tab ใหม่ที่เพิ่งเปิด
- **อย่าลืมกด Stop** — มี max 15 นาทีต่อ session แต่ถ้าลืมกด Stop จะกิน
  คิวไว้เฉย ๆ จนกว่าจะหมดเวลาหรือ stop เอง (job อื่นที่ผ่าน queue จะรอ
  อยู่หลัง เพราะ queue มี concurrency 1)
- **field ที่หน้าตาเหมือน credential (password/OTP/PIN/token/secret)
  จะไม่ถูกบันทึกค่าจริง** แม้จะอัดได้ (ดูหัวข้อ 8) — ระบบ redact ให้เอง
  อัตโนมัติ ไม่ต้องเลี่ยงเอง

---

## 7. Dangerous action / Risky-keyword confirm gate

เวลา **รัน** สคริปต์ที่เซฟไว้ (ไม่ใช่ตอนอัด) — ทุก step ที่ selector/
ข้อความมีคำใน list นี้ (case-insensitive) จะ **หยุดรอ** ก่อนทำจริงเสมอ:

```
transfer, pay, payment, confirm, submit, send, bill payment, payroll,
delete, remove, โอนเงิน, ชำระ, จ่าย, ยืนยัน, ส่ง, ลบ
```

(อยู่ใน `DANGEROUS_KEYWORDS`, `services/control-panel/src/replay-engine.ts`)

เมื่อเจอ step แบบนี้ระหว่างรัน:
1. บอทจะส่งข้อความมาทาง Telegram บอกว่า step ไหนกำลังจะทำ
2. **ต้องพิมพ์ `/confirm` ในแชท Telegram** เพื่อให้ทำต่อ หรือ `/cancel`
   เพื่อยกเลิก
3. ถ้าไม่ตอบภายใน **10 นาที** ระบบจะถือว่า cancel อัตโนมัติ
4. หน้า Recorder (ทั้ง `/` และ SCB live page) จะขึ้น banner สีเหลืองบอก
   สถานะ "รอ /confirm" ตลอดเวลาที่ค้างอยู่ — เช็คได้ผ่าน
   `GET /api/lanes/:laneId/replay-state` ด้วยถ้าไม่อยากเปิดหน้าเว็บ

**ข้อควรรู้**: นี่คือ **best-effort keyword match ไม่ใช่การรับประกัน**
— ปุ่มจริงที่ข้อความไม่ตรงกับคำใน list (เช่นใช้คำอื่น/ภาษาอื่น) จะไม่
ถูกจับ ต้องตรวจสอบ script ที่อัดไว้เองก่อนเซฟด้วยว่ามี step อันตรายจริง
หรือไม่ อย่าพึ่งกลไกนี้เป็นตัวป้องกันเดียว

---

## 8. Credential guard & redaction — ระบบป้องกันอะไรให้บ้าง

ระบบมี **2 ชั้นป้องกัน** แยกกัน ทำงานพร้อมกันเสมอ (ใช้ keyword list
เดียวกัน: `password`, `otp`, `pin`, `token`, `secret`, บวก
`type="password"`):

1. **ปฏิเสธเริ่ม recording ทั้งหมด** ถ้าหน้าปัจจุบันมี field ที่หน้าตา
   เป็น credential ที่ visible อยู่ (`input[type="password"]` หรือ
   `autocomplete`/`id`/`name` มีคำในลิสต์ด้านบน) — จะได้ error แบบนี้:
   ```
   REFUSED: a credential-shaped field (password/OTP/PIN/token/secret)
   is currently visible on this page -- recording a login/credential
   flow is not permitted, log in manually first
   ```
   แก้โดยล็อกอินให้เสร็จเองก่อน (ผ่าน noVNC) แล้วค่อยกด Start Recording
2. **Redact เป็นรายฟิลด์ระหว่างอัด** — ถ้าฟิลด์ credential โผล่ขึ้นมา
   *ระหว่าง* กำลังอัด (เช่น re-auth popup) ค่าที่พิมพ์จริงจะไม่ถูกส่งออก
   จาก browser เลย ถูกแทนที่ด้วย sentinel คงที่แทน — ตอน**รัน**สคริปต์
   ที่มี field แบบนี้ จะ **throw error ทันทีแบบดัง ๆ** (ไม่ใช่ข้าม
   เงียบ ๆ หรือพิมพ์ placeholder อะไรลงไป)

**ข้อจำกัดที่ต้องรู้**: นี่คือ best-effort เหมือนกัน — เว็บที่ใช้ custom
password widget ที่ไม่มี hint keyword พวกนี้เลย (เช่น `<input
type="text">` ธรรมดาที่ทำ masking เอง) จะไม่ถูกจับ ต้องระวังเองตอน
review step ก่อนเซฟ

---

## 9. Script เก็บไว้ที่ไหน

ไฟล์ JSON หนึ่งไฟล์ต่อหนึ่งสคริปต์ แยกตาม lane:

| lane | path บน host |
| --- | --- |
| `shared` | `data/recordings/shared/<name>.json` |
| `scb-business-anywhere-1` | `data/lanes/scb-business-anywhere-1/recordings/<name>.json` |

ทั้งสองอยู่ใต้ `data/` ซึ่ง gitignore ไว้ทั้งหมด (dev-only, ไม่ commit)
เนื้อหาไฟล์คือ `{"name": "...", "steps": [...]}` — เปิดอ่านตรงได้ด้วยตา
เปล่า ไม่มีการเข้ารหัส

**คำเตือน**: ถ้า save ชื่อซ้ำกับสคริปต์เดิม **ในเลนเดียวกัน** จะ
**เขียนทับเงียบ ๆ ไม่มี warning** — ตรวจชื่อก่อน save ให้ดี

---

## 10. `shared` lane vs `scb-business-anywhere-1` lane ต่างกันอย่างไร

| | `shared` | `scb-business-anywhere-1` |
| --- | --- | --- |
| Browser container | `browser-worker-chrome` (ตัวเดียวกับที่ใช้ XC Bank/the-internet/demo) | `browser-worker-scb-business-anywhere-1` แยกต่างหาก |
| Isolation | **ไม่แยก** — share context กับการทดสอบอื่น ๆ ทั้งหมด | แยก container/profile/noVNC เป็นของตัวเอง 100% |
| เหมาะกับ | เว็บ dev/test (mock, the-internet, ฯลฯ) | บัญชีจริง (SCB Business Anywhere) |
| คำแนะนำ | **ไม่แนะนำใช้กับบัญชีจริง** เพราะไม่มี isolation ใด ๆ | ใช้กับบัญชีจริงได้ปลอดภัยกว่า เพราะไม่มีเว็บอื่นแชร์ browser เดียวกัน |
| noVNC | `:6080` | `:6090` (เฉพาะ `127.0.0.1`) |

หน้า `/` เองก็มี warning สีแดงอยู่แล้วบน Recorder section ของ `shared`
lane ย้ำเรื่องนี้

---

## ตัวอย่าง flow ทดสอบกับ scb-mock

ทดสอบ Recorder ทั้งหมดแบบปลอดภัย 100% (ไม่แตะบัญชีจริง) โดยใช้
`services/scb-mock` ผ่าน lane `shared`:

```powershell
# 1. เปิด mock
docker compose up -d scb-mock browser-worker-chrome

# 2. เปิด Chrome lane แล้ว take control ผ่าน http://localhost:4000/
#    (หรือรัน workflow navigate ให้อัตโนมัติก็ได้ ถ้ามี workflow อยู่แล้ว)

# 3. ใน noVNC พิมพ์ URL: http://scb-mock:3000/login
#    ใส่ username/password อะไรก็ได้ (mock ไม่ตรวจสอบจริง) จนถึงหน้า
#    Account Summary
```

```bash
# 4. เริ่มอัด
curl -s -X POST http://localhost:4000/api/lanes/shared/recordings/start
# เก็บ runId/jobId ไว้

# 5. ใน noVNC: คลิกเมนู Transfers -> กรอกฟอร์ม -> Submit -> Confirm
#    (นี่คือ flow ที่ "ปลอดภัย 100%" เพราะ mock ไม่มีทางโอนเงินจริง)

# 6. หยุดอัด
curl -s -X POST http://localhost:4000/api/lanes/shared/recordings/stop \
  -H "Content-Type: application/json" -d '{"runId":"<runId>"}'

# 7. ดูผล แล้ว save (ดูขั้นตอน "ดูผลลัพธ์การอัด"/"Save" ด้านบน)
curl -s -X POST http://localhost:4000/api/lanes/shared/recordings/save \
  -H "Content-Type: application/json" \
  -d '{"name":"mock-transfer-test","steps":[...]}'

# 8. รันสคริปต์กลับ -- ควรหยุดรอ /confirm 3 ครั้ง (Transfers/Submit/Confirm
#    ล้วนตรงกับ DANGEROUS_KEYWORDS) ก่อนจะเสร็จสมบูรณ์
curl -s -X POST http://localhost:4000/api/lanes/shared/recordings/mock-transfer-test/run
```

ระหว่าง step 8 ให้เปิด Telegram รอข้อความแล้วพิมพ์ `/confirm` ทีละครั้ง
จนครบ 3 ครั้ง (หรือ `/cancel` ครั้งใดก็ได้เพื่อทดสอบเส้นทางยกเลิก) — รัน
สำเร็จจะจบที่หน้า "Mock Transfer Submitted — no real funds were moved."

---

## Troubleshooting

### "REFUSED: a credential-shaped field ... is currently visible"

กำลังพยายาม Start Recording ขณะยังอยู่หน้า login/หน้าที่มี password field
โชว์อยู่ — ล็อกอินให้เสร็จก่อน (ผ่าน noVNC) แล้วค่อยกด Start Recording
ใหม่ ไม่ใช่ bug

### `{"ok":false,"error":"Unknown lane \"...\""}`

พิมพ์ชื่อ lane ผิด — ใช้ได้แค่ `shared` หรือ `scb-business-anywhere-1`
เท่านั้น (เช็ครายชื่อ lane จริงได้จาก `services/control-panel/src/lanes.ts`)

### เซฟสคริปต์ชื่อซ้ำแล้วของเดิมหาย

ระบบเขียนทับไฟล์เงียบ ๆ ถ้าชื่อซ้ำกันในเลนเดียวกัน (ดูหัวข้อ 9) — ไม่ใช่
bug แต่ไม่มี warning ให้ ตรวจชื่อก่อน save ทุกครั้ง

### `/run <name>` บอก "saved on more than one lane"

ชื่อสคริปต์นี้ถูกเซฟไว้ในมากกว่า 1 lane พร้อมกัน (เกิดจากตั้งชื่อซ้ำกัน
เอง) — ไปลบหรือเปลี่ยนชื่ออันใดอันหนึ่งผ่าน Recorder UI ก่อน บอทจะไม่
เดาให้ว่าจะรันอันไหน

### กด Start/Save/Run แล้วไม่มีอะไรเกิดขึ้น ค้างเฉย ๆ

เช็คว่า terminal ที่รัน `npm run worker` (queue worker) ยังเปิดอยู่จริง
— ถ้าไม่ได้รัน job จะค้างสถานะ `waiting` ตลอดไปไม่มี error แจ้ง เช็คได้
ผ่าน `GET /api/jobs` (ดู field `state`) หรือหน้า `/health`

### กำลังรอ `/confirm` แต่พิมพ์ไปแล้วไม่มีอะไรเกิดขึ้น

- เช็คว่า `TELEGRAM_BOT_TOKEN_XC`/`TELEGRAM_CHAT_ID_XC` ตั้งค่าใน `.env`
  ถูกต้อง และบอทเห็นข้อความจริง (ต้องพิมพ์จากแชท/กลุ่มที่ตั้งค่าไว้
  เท่านั้น ข้อความจากที่อื่นจะถูกเมินเงียบ ๆ)
- เช็คว่ามี pending confirmation ค้างอยู่จริงหรือไม่ผ่าน
  `GET /api/lanes/:laneId/replay-state` — ถ้า `pendingConfirmation` เป็น
  `null` แปลว่าไม่มีอะไรรออยู่แล้ว (อาจ timeout ไปแล้วหลัง 10 นาที)

### "Failed to open a new tab" / CDP ไม่ตอบสนอง

Browser container อาจค้าง — ลองกดปุ่ม **Restart** ข้างสถานะ lane บนหน้า
`/` (หรือยิง `POST /api/lanes/:laneId/restart`) ก่อน ถ้ายังไม่หาย ดู
`docs/BOT_LANE_ISOLATION.md`'s "Lane health/CDP reachability" กับ
`docs/PROJECT_PLAN.md`'s decision log สำหรับ root cause ที่เคยเจอ
