import { Queue, Worker } from "bullmq";
import type { Telegraf } from "telegraf";
import { redisConnection } from "../db/redis.js";
import { BookingModel } from "../models/Booking.js";
import { UserModel } from "../models/User.js";
import {
  CONFIRMATION_REMINDER_OFFSET_MS,
  CONFIRMATION_TIMEOUT_MS,
} from "../utils/schedule.js";

const BOOKING_QUEUE_NAME = "booking-confirmation";

type ReminderJobData = {
  bookingId: string;
};

type ExpireJobData = {
  bookingId: string;
};

const bookingQueue = new Queue<ReminderJobData | ExpireJobData>(
  BOOKING_QUEUE_NAME,
  {
    connection: redisConnection,
  },
);

let bookingWorker: Worker | null = null;

const sendMessageSafe = async (
  bot: Telegraf,
  telegramId: number,
  text: string,
  extra?: Parameters<Telegraf["telegram"]["sendMessage"]>[2],
) => {
  try {
    await bot.telegram.sendMessage(telegramId, text, extra);
  } catch (error) {
    console.error("Failed to send Telegram message", error);
  }
};

export const scheduleBookingConfirmation = async (
  bookingId: string,
  appointmentAt: Date,
) => {
  const reminderDelay = Math.max(
    appointmentAt.getTime() - CONFIRMATION_REMINDER_OFFSET_MS - Date.now(),
    0,
  );

  await bookingQueue.add(
    "send-reminder",
    { bookingId },
    {
      delay: reminderDelay,
      jobId: `booking-reminder-${bookingId}`,
      removeOnComplete: true,
      removeOnFail: 50,
    },
  );
};

export const startBookingQueueWorker = (bot: Telegraf) => {
  if (bookingWorker) {
    return bookingWorker;
  }

  bookingWorker = new Worker(
    BOOKING_QUEUE_NAME,
    async (job) => {
      if (job.name === "send-reminder") {
        const { bookingId } = job.data as ReminderJobData;
        const booking = await BookingModel.findById(bookingId)
          .populate("userId")
          .populate("serviceId");

        if (!booking || booking.status === "cancelled") {
          return;
        }

        if (!booking.userId || !booking.serviceId) {
          return;
        }

        booking.status = "awaiting_confirmation";
        booking.confirmationRequestedAt = new Date();
        await booking.save();

        const user = booking.userId as InstanceType<typeof UserModel>;
        const service = booking.serviceId as { name?: string };

        if (user.telegramId) {
          await sendMessageSafe(
            bot,
            user.telegramId,
            `⏰ Напоминаем о записи!

💖 Услуга: ${service.name ?? "Услуга"}
📅 Дата: ${booking.appointmentDate}
🕒 Время: ${booking.startTime}-${booking.endTime}

Подтвердите запись в течение 2 часов, иначе она будет автоматически снята.`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "✅ Подтвердить запись",
                      callback_data: `confirm_visit_${booking.id}`,
                    },
                  ],
                ],
              },
            },
          );
        }

        await bookingQueue.add(
          "expire-booking",
          { bookingId },
          {
            delay: CONFIRMATION_TIMEOUT_MS,
            jobId: `booking-expire-${bookingId}`,
            removeOnComplete: true,
            removeOnFail: 50,
          },
        );
      }

      if (job.name === "expire-booking") {
        const { bookingId } = job.data as ExpireJobData;
        const booking = await BookingModel.findById(bookingId)
          .populate("userId")
          .populate("serviceId");

        if (!booking || booking.status !== "awaiting_confirmation") {
          return;
        }

        booking.status = "cancelled";
        booking.cancelledAt = new Date();
        booking.cancellationReason =
          "Запись снята автоматически: пользователь не подтвердил визит за 2 часа";
        await booking.save();

        const user = booking.userId as InstanceType<typeof UserModel>;
        const service = booking.serviceId as { name?: string };

        if (user.telegramId) {
          await sendMessageSafe(
            bot,
            user.telegramId,
            `❌ Запись снята автоматически.

💖 Услуга: ${service.name ?? "Услуга"}
📅 Дата: ${booking.appointmentDate}
🕒 Время: ${booking.startTime}-${booking.endTime}

Мы не получили подтверждение в течение 2 часов после напоминания.`,
          );
        }
      }
    },
    {
      connection: redisConnection,
    },
  );

  bookingWorker.on("failed", (job, error) => {
    console.error("Booking queue job failed", job?.name, error);
  });

  return bookingWorker;
};

export const closeBookingQueue = async () => {
  await Promise.allSettled([bookingQueue.close(), bookingWorker?.close()]);
  bookingWorker = null;
};
