# Hướng dẫn cài đặt Telegram Bot

## 1. Tạo Bot trên Telegram

1. Mở Telegram, tìm **@BotFather**
2. Gửi lệnh `/newbot`
3. Đặt tên bot (VD: `VPS Monitor Bot`)
4. Đặt username bot (VD: `vps_monitor_bot`)
5. BotFather sẽ trả về **Bot Token** (dạng `123456789:AAH...`)
6. Copy token này

## 2. Lấy Chat ID

### Cách 1: Chat trực tiếp với bot
1. Mở bot bạn vừa tạo trên Telegram, gửi `/start`
2. Truy cập: `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Tìm `"chat":{"id":123456789}` — đó là Chat ID

### Cách 2: Gửi vào Group
1. Thêm bot vào group Telegram
2. Gửi 1 tin nhắn bất kỳ trong group
3. Truy cập: `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Chat ID cho group sẽ là số âm (VD: `-1001234567890`)

## 3. Cấu hình trên Dashboard

1. Đăng nhập dashboard → **Settings**
2. Mục **Telegram Alerts**:
   - Paste **Bot Token** vào ô "Bot Token"
   - Paste **Chat ID** vào ô "Chat ID"
   - Chỉnh ngưỡng CPU, RAM, Disk (mặc định 85%, 85%, 90%)
   - Chỉnh cooldown (mặc định 300s = 5 phút)
3. Click **Save**
4. Click **Send Test** để kiểm tra

## 4. Khởi động Bot

Bot tự động khởi động khi API server chạy. Nếu thêm token sau khi server đã chạy, restart API server:

```bash
# Development
npm run dev:api

# Production
npm run start:api
```

## 5. Sử dụng Bot

Mở bot trên Telegram và gửi các lệnh:

| Lệnh | Mô tả |
|-------|--------|
| `/start` | Bắt đầu & hiện menu |
| `/status` | Tổng quan fleet (total servers, online/offline) |
| `/servers` | Danh sách tất cả server |
| `/server web-01` | Chi tiết server có tên "web-01" |
| `/alerts` | Xem cấu hình cảnh báo |
| `/backup` | Cloud backup status |
| `/help` | Hiện danh sách lệnh |

## 6. Tính năng Alert tự động

Ngoài các lệnh thủ công, bot còn tự động gửi thông báo khi:

- **CPU/RAM/Disk vượt ngưỡng**: Khi metrics của server vượt ngưỡng đã cấu hình
- **Server offline**: Khi server mất kết nối hoặc shutdown
- **Cooldown**: Mỗi server chỉ nhận 1 alert mỗi 5 phút (tùy chỉnh)

## Troubleshooting

### Bot không phản hồi
- Kiểm tra API server đang chạy (`curl http://localhost:4000/api/health`)
- Kiểm tra bot token đúng (không có khoảng trắng thừa)
- Restart API server sau khi thay đổi token

### Alert không gửi
- Kiểm tra Chat ID đúng
- Click "Send Test" trong Settings để test
- Kiểm tra cooldown chưa hết (mặc định 5 phút giữa các alert)
