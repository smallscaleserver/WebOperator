# WebOperator
แนวคิดหลัก  ไม่ควรออกแบบเป็นสคริปต์ยาวชุดเดียว แต่แบ่งเป็น:  ระบบกลางจัดคิวงาน Browser Worker ใน Docker ชุดคำสั่งเฉพาะแต่ละเว็บไซต์ ระบบจัดการเหตุการณ์ไม่คาดคิด หน้าจอควบคุมและรับช่วงทำงานด้วยมือ ระบบเก็บ Session/Cookie อย่างเข้ารหัส

flowchart TD
    U["Web Control Panel"] --> A["WebSteward API"]
    A --> Q["Task Queue"]
    Q --> W["Browser Worker"]
    W --> B["Chrome / Firefox"]
    B --> S["Website"]
    W --> E["Event & Recovery Engine"]
    E -->|แก้ได้อัตโนมัติ| B
    E -->|ต้องใช้คน| H["Manual Takeover ผ่าน noVNC"]
    W --> D["Extracted Data"]
    W --> L["Logs / Screenshot / Trace"]
    V["Encrypted Session Vault"] <--> W

เทคโนโลยีที่แนะนำ
Browser automation: Playwright

เลือก Playwright + TypeScript เป็นแกนหลัก เพราะ:

รองรับ Chromium, Chrome และ Firefox
จัดการแท็บ, popup, iframe, download และ dialog ได้ดี
เก็บ screenshot, video และ trace ย้อนดูปัญหาได้
ใช้ persistent browser profile ได้
รองรับ headed mode คือเปิดเบราว์เซอร์จริง ไม่ใช่ทำงานเงียบๆ อย่างเดียว

Playwright มี Docker image และแนวทางตั้งค่า sandbox/seccomp โดยตรงในเอกสาร Docker อย่างเป็นทางการ และรองรับการบันทึก/นำ authentication state กลับมาใช้ใหม่ตามเอกสาร Authentication

หน้าจอระยะไกล

ภายใน Browser Worker ใช้:

Xvfb สร้างจอ Linux เสมือน
Window manager เช่น Fluxbox
Chrome/Firefox แบบ headed
x11vnc ส่งภาพหน้าจอ
noVNC ทำให้ดูและควบคุมผ่านเว็บเบราว์เซอร์ได้

ผู้ดูแลจึงเปิดประมาณนี้ได้:

https://server/browser/session-123

และเห็น Chrome เหมือน Remote Desktop สามารถคลิก พิมพ์ login ยืนยัน 2FA หรือแก้ปัญหาเฉพาะหน้าได้ noVNC เป็น VNC client ที่ทำงานผ่าน HTML5/WebSocket ตามโครงการ noVNC

Gmail ควรแยกเป็นสองวิธี
วิธีหลัก: Gmail API + OAuth 2.0

สำหรับอ่านหัวข้อ เนื้อหา ไฟล์แนบ ค้นหาอีเมล หรือส่งอีเมล ควรใช้ Gmail API เพราะเสถียรกว่าการเปิดหน้า Gmail แล้วคลิก

ผู้ใช้กดอนุญาตผ่าน OAuth
เก็บ refresh token แบบเข้ารหัส
ขอเฉพาะ scope ที่จำเป็น
ไม่ต้องเก็บรหัสผ่าน Gmail
ไม่ต้องรับมือกับหน้า Gmail เปลี่ยน layout

Google กำหนดให้ขอสิทธิ์เท่าที่จำเป็น และ scope บางประเภทอาจต้องผ่านการตรวจสอบก่อนเปิดให้ผู้ใช้ทั่วไป ตามนโยบาย OAuth 2.0 และคู่มือ OAuth สำหรับ Web Server

วิธีสำรอง: Browser Worker

ใช้เมื่อจำเป็นต้องทำงานบางอย่างที่ API ทำไม่ได้ แต่ไม่ควรพยายามหลบ CAPTCHA หรือระบบรักษาความปลอดภัย หากพบ CAPTCHA, passkey หรือ 2FA ให้หยุดงานแล้วเรียกคนเข้าควบคุม

โครงสร้าง Website Adapter

แต่ละเว็บไซต์ควรเป็นโมดูลแยก ไม่ hard-code ทุกอย่างรวมกัน:

adapters/
├── gmail/
├── supplier-a/
├── customer-portal/
├── government-web/
└── generic-web/

ตัวอย่าง interface:

interface SiteAdapter {
  detectPage(page): Promise<PageState>;
  login(context): Promise<LoginResult>;
  execute(task, context): Promise<TaskResult>;
  recover(event, context): Promise<RecoveryResult>;
  extract(context): Promise<ExtractedData>;
}

แต่ละ adapter มี:

URL ที่อนุญาต
วิธีตรวจว่าล็อกอินแล้วหรือยัง
selector ของปุ่มและช่องข้อมูล
กฎปิด popup
กฎดึงข้อมูล
วิธีตรวจว่าทำงานสำเร็จ
ระดับความเสี่ยงของ action
ระบบรับมือเหตุการณ์ไม่คาดคิด

สร้าง Event & Recovery Engine ตรวจเหตุการณ์เป็นลำดับ:

| เหตุการณ์           | การจัดการ                                   |
| ------------------- | ------------------------------------------- |
| Cookie banner       | กดปฏิเสธหรือยอมรับตาม policy                |
| Popup โปรโมชั่น     | ปิดตาม selector หรือข้อความ                 |
| JavaScript dialog   | บันทึกข้อความแล้ว accept/dismiss            |
| เปิดแท็บใหม่        | ตรวจ URL และผูกเข้ากับ task                 |
| Session หมดอายุ     | ลอง obnov session หรือขอ login ใหม่         |
| หน้าโหลดค้าง        | reload หนึ่งครั้ง แล้ว retry แบบมีระยะห่าง  |
| Selector เปลี่ยน    | หาโดย role/text สำรอง                       |
| ดาวน์โหลดไฟล์       | ตรวจชื่อ ขนาด MIME และ checksum             |
| CAPTCHA/2FA/passkey | หยุดและส่ง Manual Takeover                  |
| URL ผิดโดเมน        | หยุดทันที                                   |
| ทำงานซ้ำหลายครั้ง   | Circuit breaker ป้องกันคลิกหรือส่งข้อมูลซ้ำ |


ทุก step ควรบันทึก:

URL และชื่อหน้า
screenshot ก่อน/หลัง
DOM snapshot เฉพาะส่วนสำคัญ
console error และ network error
เวลาเริ่มและสิ้นสุด
action ที่ระบบทำ
ข้อมูลสำคัญต้อง mask ก่อนบันทึก log
Session และความปลอดภัย

ไม่ควรเก็บ email/password ใน source code หรือไฟล์ .env ธรรมดา

ควรมี Session Vault:

เข้ารหัส cookie, token และ browser profile
แยก vault ต่อผู้ใช้และต่อเว็บไซต์
กำหนดวันหมดอายุ
revoke session ได้
ไม่ส่ง cookie กลับไปยังหน้า dashboard
จำกัด worker ให้ออกอินเทอร์เน็ตได้เฉพาะโดเมนที่กำหนด
หนึ่ง container ต่อหนึ่ง active session สำหรับเว็บสำคัญ
noVNC ต้องผ่าน HTTPS, login และ URL อายุสั้น
เก็บ audit log ว่าใครเข้าควบคุมตอนไหน
ภาษาที่เหมาะสม

สำหรับระยะแรก ผมแนะนำ:

TypeScript/Node.js: Playwright worker และ website adapters
PostgreSQL: task, account metadata, audit log
Redis + BullMQ: queue, retry, scheduling
MinIO/S3: screenshot, video, download และ trace
React หรือ Vue: Control Panel
Docker Compose: รุ่นเริ่มต้น
Go: ค่อยนำมาใช้กับ API/control plane ภายหลัง หากต้องการ binary เล็กและรองรับ worker จำนวนมาก

แม้คุณถนัด Go แต่ Playwright ฝั่ง TypeScript มีตัวอย่างและ ecosystem ตรงที่สุด จึงเหมาะกับ Browser Worker มากกว่า ส่วน backend กลางเขียน Go ได้โดยไม่ขัดกัน

สถานะของงาน

stateDiagram-v2
    [*] --> Queued
    Queued --> Starting
    Starting --> Running
    Running --> Recovering: popup / timeout
    Recovering --> Running: แก้สำเร็จ
    Running --> WaitingHuman: CAPTCHA / 2FA
    WaitingHuman --> Running: ผู้ใช้แก้แล้ว
    Running --> Completed
    Running --> Failed: เกินจำนวน retry
    WaitingHuman --> Expired: ไม่มีผู้รับช่วง

แผนพัฒนา
Phase 1 — Prototype
Docker เปิด Chromium แบบเห็นหน้าจอ
เชื่อม noVNC
Control Panel มี Start/Stop/Take control
เปิดเว็บ ทดลอง login ด้วยมือ
บันทึกและนำ browser session กลับมาใช้
ทำ adapter เว็บตัวอย่างหนึ่งเว็บ
Phase 2 — Task Engine
Queue และ scheduler
Step-based workflow
screenshot/trace ทุกจุดสำคัญ
retry, timeout และ circuit breaker
ดาวน์โหลดและจัดเก็บข้อมูล
Phase 3 — Gmail
Google OAuth
อ่าน ค้นหา และดาวน์โหลดไฟล์แนบผ่าน Gmail API
Browser fallback เฉพาะกรณีจำเป็น
Encrypted token vault
Phase 4 — Universal Adapters
ระบบ plugin สำหรับเพิ่มเว็บไซต์
Popup rules กลาง
page-state detection
selector หลายระดับ: role → label → text → CSS
workflow versioning เพื่อย้อนกลับเมื่อเว็บเปลี่ยน
Phase 5 — Production
แยก worker หลายเครื่อง
Chrome และ Firefox profiles
สิทธิ์ผู้ใช้และ audit log
domain allowlist
monitoring และแจ้งเตือน
backup/restore session vault
MVP ที่ควรเริ่มจริง

รุ่นแรกไม่ต้องพยายาม “เข้าได้ทุกเว็บ” เพราะแต่ละเว็บมี login และโครงสร้างต่างกัน ควรตั้งเป้าเป็น:

WebSteward MVP สามารถเปิด Chromium ใน Docker, แสดงและควบคุมผ่าน noVNC, เก็บ session แบบเข้ารหัส, ทำ workflow ทีละ step, ปิด popup พื้นฐาน, หยุดรอคนเมื่อพบ 2FA/CAPTCHA และดึงข้อมูลจาก Gmail API กับเว็บไซต์ตัวอย่างหนึ่งแห่งได้

โครงสร้างนี้จะขยายเป็นระบบ universal ได้จริง และไม่เปราะเท่าการสร้างบอตที่อาศัยการคลิกตามตำแหน่งหน้าจอเพียงอย่างเดียวครับ
