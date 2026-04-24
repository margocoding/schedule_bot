import "dotenv/config";
import { Markup, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { assertConfig, config } from "./config/config.js";
import { closeRedis } from "./db/redis.js";
import { connectMongo, disconnectMongo } from "./db/mongo.js";
import { AppSettingsModel } from "./models/AppSettings.js";
import { BookingModel } from "./models/Booking.js";
import { ServiceModel } from "./models/Service.js";
import { UserModel } from "./models/User.js";
import {
  closeBookingQueue,
  scheduleBookingConfirmation,
  startBookingQueueWorker,
} from "./queues/bookingQueue.js";
import { buildDate, calendar, getMonthState } from "./utils/date.js";
import {
  DEFAULT_WORKDAY_END_MINUTES,
  DEFAULT_WORKDAY_START_MINUTES,
  SLOT_INTERVAL_MINUTES,
  formatDuration,
  formatLocalDateKey,
  formatMinutesToTime,
  getCurrentMinutes,
  getDateFromDateAndTime,
  getTodayDateKey,
  isTimeRangeOverlapping,
  parseTimeToMinutes,
} from "./utils/schedule.js";

const bot = new Telegraf(config.TELEGRAM_TOKEN);

const ACTIVE_BOOKING_STATUSES = [
  "scheduled",
  "awaiting_confirmation",
  "confirmed",
] as const;

const pendingActions = new Map<
  number,
  | { type: "awaiting_service_input" }
  | { type: "awaiting_workday_input" }
  | { type: "awaiting_contacts_input" }
  | { type: "awaiting_phone_for_booking"; bookingData: any }
>();

const defaultServices = [
  { name: "Маникюр", price: "1000 руб.", durationMinutes: 30 },
  { name: "Педикюр", price: "1500 руб.", durationMinutes: 60 },
  { name: "Стрижка", price: "1200 руб.", durationMinutes: 60 },
  { name: "Окрашивание", price: "2000 руб.", durationMinutes: 120 },
];

const getMainMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("💇‍♀️ Записаться на услугу", "open_service_picker")],
    [Markup.button.callback("📅 Мои записи", "my_records")],
    [Markup.button.callback("💖 Услуги и цены", "services")],
    [Markup.button.callback("📍 Контакты и адрес", "contacts")],
    [Markup.button.callback("❓ Помощь", "help")],
    [Markup.button.callback("📸 Портфолио", "portfolio")],
  ]);

const getAdminReplyKeyboard = () =>
  Markup.keyboard([["Админ-панель"]]).resize();

const getPhoneRequestKeyboard = () =>
  Markup.keyboard([[Markup.button.contactRequest("📱 Поделиться номером")]])
    .oneTime()
    .resize();

const statusLabels: Record<string, string> = {
  scheduled: "запись создана",
  awaiting_confirmation: "ждет подтверждения",
  confirmed: "подтверждена",
  cancelled: "отменена",
};

const sendMessageSafe = async (
  telegramId: number,
  text: string,
  extra?: Parameters<typeof bot.telegram.sendMessage>[2],
) => {
  try {
    await bot.telegram.sendMessage(telegramId, text, extra);
  } catch (error) {
    console.error("Failed to send Telegram message", error);
  }
};

const getAppSettings = async () => {
  const settings = await AppSettingsModel.findOneAndUpdate(
    { key: "default" },
    {
      $setOnInsert: {
        workdayStartMinutes: DEFAULT_WORKDAY_START_MINUTES,
        workdayEndMinutes: DEFAULT_WORKDAY_END_MINUTES,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );

  return settings;
};

const getWorkdaySettings = async () => {
  const settings = await getAppSettings();

  return {
    startMinutes: settings.workdayStartMinutes,
    endMinutes: settings.workdayEndMinutes,
  };
};

const syncTelegramUser = async (from: NonNullable<typeof bot.context.from>) => {
  const shouldBeAdmin = config.ADMIN_TELEGRAM_IDS.includes(from.id);

  const user = await UserModel.findOneAndUpdate(
    { telegramId: from.id },
    {
      $set: {
        username: from.username ?? null,
        firstName: from.first_name ?? null,
        lastName: from.last_name ?? null,
      },
      $setOnInsert: {
        isAdmin: shouldBeAdmin,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );

  if (shouldBeAdmin && !user.isAdmin) {
    user.isAdmin = true;
    await user.save();
  }

  return user;
};

const getRegisteredUser = async (telegramId?: number | null) => {
  if (!telegramId) {
    return null;
  }

  return UserModel.findOne({ telegramId });
};

const promptPhoneRequest = async (ctx: any) =>
  ctx.reply(
    "📱 Перед записью нужно сохранить ваш номер телефона. Нажмите кнопку ниже, чтобы поделиться контактом.",
    getPhoneRequestKeyboard(),
  );

const sendMainMenu = async (ctx: any, user: any) => {
  if (user.isAdmin) {
    await ctx.reply(
      "👨‍💼 Для быстрого доступа снизу доступна кнопка `Админ-панель`.",
      {
        parse_mode: "Markdown",
        ...getAdminReplyKeyboard(),
      },
    );
  } else {
    await ctx.reply("✨ Главное меню", Markup.removeKeyboard());
  }

  return ctx.reply(
    `👋 Добро пожаловать в наш бьюти-салон!

Я помогу быстро записаться и напомню подтвердить визит за 24 часа.
Если не подтвердить запись в течение 2 часов после напоминания, она автоматически снимется.

Выберите действие:`,
    getMainMenuKeyboard(),
  );
};

const ensureRegisteredWithPhone = async (ctx: any) => {
  const telegramId = ctx.from?.id;
  const user = await getRegisteredUser(telegramId);

  if (!user) {
    return null;
  }

  return user;
};

const getYearMonthFromDate = (date: string) => {
  const [yearText, monthText] = date.split("-");

  return {
    year: Number(yearText),
    month: Number(monthText) - 1,
  };
};

const isValidTimeString = (value: string) => {
  const timePattern = /^\d{2}:\d{2}$/;

  if (!timePattern.test(value)) {
    return false;
  }

  const [hoursText, minutesText] = value.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

const getServiceSelectionText = () =>
  '📝✨ Вы выбрали "Записаться на услугу"!\n\nПожалуйста, выберите услугу из списка 👇';

const getActiveServices = async () =>
  (await ServiceModel.find({ isActive: true }).sort({ createdAt: 1 }).lean()) as any[];

const getServiceSelectionKeyboard = async () => {
  const services = await getActiveServices();

  return Markup.inlineKeyboard(
    services.map((service: any) => [
      Markup.button.callback(
        `💅 ${service.name} — ${service.price} • ${formatDuration(service.durationMinutes)}`,
        `pick_service_${service._id.toString()}`,
      ),
    ]),
  );
};

const getServiceById = async (serviceId: string) =>
  (await ServiceModel.findById(serviceId).lean()) as any | null;

const hasAvailableSlotsForDate = async (
  date: string,
  service: any,
  workday: { startMinutes: number; endMinutes: number },
) => {
  const slots = await getAvailableSlots(date, service, workday);
  return slots.some((slot) => slot.isAvailable);
};

const getUserCalendarKeyboard = async (
  year: number,
  month: number,
  serviceId: string,
) => {
  const service = await getServiceById(serviceId);

  if (!service) {
    return [];
  }

  const workday = await getWorkdaySettings();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const hiddenDateKeys = new Set<string>();

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateKey = formatLocalDateKey(date);
    const hasAvailableSlots = await hasAvailableSlotsForDate(
      dateKey,
      service,
      workday,
    );

    if (!hasAvailableSlots) {
      hiddenDateKeys.add(dateKey);
    }
  }

  const keyboard = buildDate(year, month, "user", serviceId, hiddenDateKeys);

  keyboard.push([
    {
      text: "⬅️ Назад",
      callback_data: "back_to_services",
    },
  ]);

  return keyboard;
};

const getActiveBookingsForDate = async (date: string) =>
  (await BookingModel.find({
    appointmentDate: date,
    status: { $in: ACTIVE_BOOKING_STATUSES },
  }).lean()) as any[];

const getAvailableSlots = async (
  date: string,
  service: any,
  workday?: { startMinutes: number; endMinutes: number },
) => {
  const resolvedWorkday = workday ?? (await getWorkdaySettings());
  const bookings = await getActiveBookingsForDate(date);
  const slots: Array<{
    time: string;
    endTime: string;
    isAvailable: boolean;
  }> = [];

  for (
    let startMinutes = resolvedWorkday.startMinutes;
    startMinutes + service.durationMinutes <= resolvedWorkday.endMinutes;
    startMinutes += SLOT_INTERVAL_MINUTES
  ) {
    const endMinutes = startMinutes + service.durationMinutes;
    const isToday = date === getTodayDateKey();
    const currentMinutes = getCurrentMinutes();
    const isPastForToday = isToday && startMinutes <= currentMinutes;
    const isAvailable = !bookings.some((booking: any) =>
      isTimeRangeOverlapping(
        startMinutes,
        endMinutes,
        booking.startMinutes,
        booking.endMinutes,
      ),
    ) && !isPastForToday;

    slots.push({
      time: formatMinutesToTime(startMinutes),
      endTime: formatMinutesToTime(endMinutes),
      isAvailable,
    });
  }

  return slots;
};

const isSlotAvailable = async (date: string, time: string, service: any) => {
  const workday = await getWorkdaySettings();
  const startMinutes = parseTimeToMinutes(time);
  const endMinutes = startMinutes + service.durationMinutes;

  if (
    startMinutes < workday.startMinutes ||
    endMinutes > workday.endMinutes ||
    (date === getTodayDateKey() && startMinutes <= getCurrentMinutes())
  ) {
    return false;
  }

  const bookings = await getActiveBookingsForDate(date);

  return !bookings.some((booking: any) =>
    isTimeRangeOverlapping(
      startMinutes,
      endMinutes,
      booking.startMinutes,
      booking.endMinutes,
    ),
  );
};

const getTimeKeyboard = async (date: string, service: any) => {
  const keyboard: any[] = [];
  let row: any[] = [];

  const slots = await getAvailableSlots(date, service);

  slots.forEach((slot) => {
    row.push({
      text: `${slot.time}-${slot.endTime} ${slot.isAvailable ? "🟢" : "🔴"}`,
      callback_data: slot.isAvailable
        ? `select_time_${date}_${slot.time}_${service._id.toString()}`
        : `busy_time_${date}_${slot.time}`,
    });

    if (row.length === 3) {
      keyboard.push(row);
      row = [];
    }
  });

  if (row.length > 0) {
    keyboard.push(row);
  }

  keyboard.push([
    {
      text: "⬅️ Назад к датам",
      callback_data: `back_to_calendar_${date}_${service._id.toString()}`,
    },
  ]);

  return keyboard;
};

const getTimeSelectionText = async (date: string, service: any) => {
  const workday = await getWorkdaySettings();
  const slots = await getAvailableSlots(date, service, workday);
  const availableCount = slots.filter((slot) => slot.isAvailable).length;

  return `📅 Дата: ${date}

💖 Услуга: ${service.name}
⏱ Длительность: ${formatDuration(service.durationMinutes)}
🕒 Рабочий день: ${formatMinutesToTime(workday.startMinutes)}-${formatMinutesToTime(workday.endMinutes)}
✨ Свободных стартов: ${availableCount}

Выбери удобное время:`;
};

const editUserCalendar = async (
  ctx: any,
  serviceId: string,
  year: number,
  month: number,
) => {
  const service = await getServiceById(serviceId);

  if (!service) {
    return ctx.answerCbQuery("Не удалось найти услугу");
  }

  return ctx.editMessageText(
    `🎉 Отличный выбор!

💖 Услуга: ${service.name}
⏱ Длительность: ${formatDuration(service.durationMinutes)}

📅 Выбери дату:`,
    {
      reply_markup: {
        inline_keyboard: await getUserCalendarKeyboard(year, month, serviceId),
      },
    },
  );
};

const editTimeSelection = async (ctx: any, date: string, serviceId: string) => {
  const service = await getServiceById(serviceId);

  if (!service) {
    return ctx.answerCbQuery("Не удалось найти услугу");
  }

  return ctx.editMessageText(await getTimeSelectionText(date, service), {
    reply_markup: {
      inline_keyboard: await getTimeKeyboard(date, service),
    },
  });
};

const notifyAdminsAboutBooking = async (booking: any, user: any, service: any) => {
  const admins = await UserModel.find({
    isAdmin: true,
    telegramId: { $exists: true },
  }).lean();

  const text = `🔔 Новая запись!

👤 Клиент: ${user.firstName ?? "Без имени"}${user.lastName ? ` ${user.lastName}` : ""}
📱 Телефон: ${user.phoneNumber ?? "не указан"}
💖 Услуга: ${service.name}
📅 Дата: ${booking.appointmentDate}
🕒 Время: ${booking.startTime}-${booking.endTime}`;

  await Promise.all(
    admins.map((admin: any) => sendMessageSafe(admin.telegramId, text)),
  );
};

const notifyAdminsAboutCancelledBooking = async (
  booking: any,
  user: any,
  service: any,
) => {
  const admins = await UserModel.find({
    isAdmin: true,
    telegramId: { $exists: true },
  }).lean();

  const text = `❌ Запись отменена клиентом!

👤 Клиент: ${user.firstName ?? "Без имени"}${user.lastName ? ` ${user.lastName}` : ""}
📱 Телефон: ${user.phoneNumber ?? "не указан"}
💖 Услуга: ${service?.name ?? "Услуга"}
📅 Дата: ${booking.appointmentDate}
🕒 Время: ${booking.startTime}-${booking.endTime}`;

  await Promise.all(
    admins.map((admin: any) => sendMessageSafe(admin.telegramId, text)),
  );
};

const buildUserBookingsView = async (userId: any) => {
  const bookings = await BookingModel.find({
    userId,
    status: { $ne: "cancelled" },
  })
    .sort({ appointmentAt: 1 })
    .populate("serviceId");

  if (bookings.length === 0) {
    return {
      text: "📅 Ваши записи:\n\nПока что у вас нет активных бронирований ✨",
      reply_markup: undefined,
    };
  }

  const lines = bookings.map((booking: any, index: number) => {
    const service = booking.serviceId as any;
    return `${index + 1}. ${booking.appointmentDate} • ${booking.startTime}-${booking.endTime} • ${service?.name ?? "Услуга"} • ${statusLabels[booking.status]}`;
  });

  return {
    text: `📅 Ваши записи:\n\n${lines.join("\n")}\n\nВыберите запись для отмены:`,
    reply_markup: {
      inline_keyboard: bookings.map((booking: any) => {
        const service = booking.serviceId as any;

        return [
          {
            text: `Отменить: ${booking.appointmentDate} ${booking.startTime} • ${service?.name ?? "Услуга"}`,
            callback_data: `cancel_booking_${booking._id.toString()}`,
          },
        ];
      }),
    },
  };
};

const buildAdminServiceDeleteView = async () => {
  const services = await ServiceModel.find({ isActive: true })
    .sort({ createdAt: 1 })
    .lean();

  if (services.length === 0) {
    return {
      text: "🗑 Активных услуг для удаления нет.",
      reply_markup: undefined,
    };
  }

  return {
    text: "🗑 Выберите услугу, которую нужно скрыть из записи:",
    reply_markup: {
      inline_keyboard: services.map((service: any) => [
        {
          text: `${service.name} • ${service.price} • ${formatDuration(service.durationMinutes)}`,
          callback_data: `admin_service_delete_${service._id.toString()}`,
        },
      ]),
    },
  };
};

const buildWorkdaySettingsText = async () => {
  const workday = await getWorkdaySettings();

  return `🕒 Текущий рабочий день:

Начало: ${formatMinutesToTime(workday.startMinutes)}
Конец: ${formatMinutesToTime(workday.endMinutes)}

Чтобы изменить рабочий день, нажмите на кнопку ниже и отправьте время в формате:
HH:MM | HH:MM

Пример:
10:00 | 18:00`;
};

const ensureDefaultServices = async () => {
  const serviceCount = await ServiceModel.countDocuments();

  if (serviceCount > 0) {
    return;
  }

  await ServiceModel.insertMany(defaultServices);
};

const ensureDefaultAppSettings = async () => {
  await getAppSettings();
};

const buildContactsSettingsText = () => {
  return `📞 Текущие контакты и адрес:

Телефон: ${config.CONTACT_PHONE || "не указан"}
Адрес: ${config.ADDRESS || "не указан"}

Чтобы изменить контакты, нажмите на кнопку ниже и отправьте в формате:
Телефон | Адрес

Пример:
+7 (999) 123-45-67 | Москва, ул. Примерная, 1

Адрес является опциональным полем.`;
};

bot.start(async (ctx) => {
  if (!ctx.from) {
    return;
  }

  const user = await syncTelegramUser(ctx.from);

  return sendMainMenu(ctx, user);
});

bot.on(message("contact"), async (ctx) => {
  if (!ctx.from) {
    return;
  }

  const sharedContact = ctx.message.contact;

  if (sharedContact.user_id && sharedContact.user_id !== ctx.from.id) {
    return ctx.reply(
      "Пожалуйста, поделитесь своим номером через кнопку ниже.",
      getPhoneRequestKeyboard(),
    );
  }

  const user = await syncTelegramUser(ctx.from);

  user.phoneNumber = sharedContact.phone_number;
  await user.save();

  // Check if there's a pending booking awaiting phone
  const pendingAction = pendingActions.get(user.telegramId);
  if (
    pendingAction &&
    pendingAction.type === "awaiting_phone_for_booking"
  ) {
    const { bookingData } = pendingAction;
    pendingActions.delete(user.telegramId);

    const service = await getServiceById(bookingData.serviceId);
    if (!service) {
      await ctx.reply("Ошибка при создании записи.");
      return;
    }

    const appointmentAt = getDateFromDateAndTime(
      bookingData.date,
      bookingData.time,
    );
    const startMinutes = parseTimeToMinutes(bookingData.time);
    const endMinutes = startMinutes + service.durationMinutes;
    const endTime = formatMinutesToTime(endMinutes);
    const endAt = getDateFromDateAndTime(bookingData.date, endTime);

    const booking = await BookingModel.create({
      userId: user._id,
      serviceId: service._id,
      appointmentDate: bookingData.date,
      appointmentAt,
      endAt,
      startTime: bookingData.time,
      endTime,
      startMinutes,
      endMinutes,
      status: "scheduled",
    });

    await scheduleBookingConfirmation(booking.id, appointmentAt);
    await notifyAdminsAboutBooking(booking, user, service);

    return ctx.reply(
      `✅ Запись создана!

💖 Услуга: ${service.name}
📅 Дата: ${bookingData.date}
🕒 Время: ${bookingData.time}-${endTime}
⏱ Длительность: ${formatDuration(service.durationMinutes)}

⏰ За 24 часа до визита мы отправим запрос на подтверждение.
Если не подтвердить запись в течение 2 часов после напоминания, она автоматически снимется.

До встречи ✨`,
    );
  }

  await ctx.reply("✅ Номер телефона сохранен.");

  return sendMainMenu(ctx, user);
});

bot.action("open_service_picker", async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  await ctx.answerCbQuery();

  const services = await getActiveServices();

  if (services.length === 0) {
    return ctx.reply("Сейчас нет доступных услуг. Попробуйте позже.");
  }

  return ctx.reply(
    getServiceSelectionText(),
    await getServiceSelectionKeyboard(),
  );
});

bot.action(/^pick_service_([a-fA-F0-9]{24})$/, async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  const serviceId = ctx.match[1];

  if (!serviceId) {
    return;
  }

  const state = getMonthState(0);

  await ctx.answerCbQuery("✅ Вы выбрали услугу");

  return editUserCalendar(ctx, serviceId, state.year, state.month);
});

bot.action(
  /^month_(next|prev)_(\d{4})_(\d{1,2})_(admin|user)_(.+)$/,
  async (ctx) => {
    const user = await ensureRegisteredWithPhone(ctx);

    if (!user) {
      return;
    }

    const direction = ctx.match[1];
    const yearText = ctx.match[2];
    const monthText = ctx.match[3];
    const mode = ctx.match[4];
    const serviceIdToken = ctx.match[5];

    if (!direction || !yearText || !monthText || !mode || !serviceIdToken) {
      return;
    }

    const displayedMonth = new Date(Number(yearText), Number(monthText), 1);

    displayedMonth.setMonth(
      displayedMonth.getMonth() + (direction === "next" ? 1 : -1),
    );

    await ctx.answerCbQuery();

    if (mode === "user") {
      if (serviceIdToken === "none") {
        return;
      }

      return ctx.editMessageReplyMarkup({
        inline_keyboard: await getUserCalendarKeyboard(
          displayedMonth.getFullYear(),
          displayedMonth.getMonth(),
          serviceIdToken,
        ),
      });
    }

    if (!user.isAdmin) {
      return ctx.reply("⛔ Доступ только для администратора");
    }

    return ctx.editMessageReplyMarkup({
      inline_keyboard: buildDate(
        displayedMonth.getFullYear(),
        displayedMonth.getMonth(),
        "admin",
      ),
    });
  },
);

bot.action(/^select_date_([^_]+)_([a-fA-F0-9]{24})$/, async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  const date = ctx.match[1];
  const serviceId = ctx.match[2];

  if (!date || !serviceId) {
    return;
  }

  const service = await getServiceById(serviceId);

  if (!service) {
    return ctx.answerCbQuery("Не удалось найти услугу");
  }

  await ctx.answerCbQuery("📅 Дата выбрана");

  return editTimeSelection(ctx, date, serviceId);
});

bot.action(/^back_to_calendar_([^_]+)_([a-fA-F0-9]{24})$/, async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  const date = ctx.match[1];
  const serviceId = ctx.match[2];

  if (!date || !serviceId) {
    return;
  }

  const { year, month } = getYearMonthFromDate(date);

  await ctx.answerCbQuery();

  return editUserCalendar(ctx, serviceId, year, month);
});

bot.action(/^select_time_([^_]+)_([^_]+)_([a-fA-F0-9]{24})$/, async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return ctx.answerCbQuery("Ошибка при загрузке профиля");
  }

  const date = ctx.match[1];
  const time = ctx.match[2];
  const serviceId = ctx.match[3];

  if (!date || !time || !serviceId) {
    return;
  }

  const service = await getServiceById(serviceId);

  if (!service) {
    return ctx.answerCbQuery("Не удалось найти услугу");
  }

  if (!isSlotAvailable(date, time, service)) {
    await ctx.answerCbQuery("Этот слот уже заняли, обновляю расписание");
    return editTimeSelection(ctx, date, serviceId);
  }

  const endTime = formatMinutesToTime(
    parseTimeToMinutes(time) + service.durationMinutes,
  );

  await ctx.answerCbQuery("✅ Время выбрано");

  // If user doesn't have phone, ask for it now
  if (!user.phoneNumber) {
    pendingActions.set(user.telegramId, {
      type: "awaiting_phone_for_booking",
      bookingData: {
        date,
        time,
        serviceId,
      },
    });

    return ctx.editMessageText(
      `🎉 Отлично!

💖 Услуга: ${service.name}
📅 Дата: ${date}
🕒 Время: ${time}-${endTime}
⏱ Длительность: ${formatDuration(service.durationMinutes)}

📱 Перед завершением записи поделитесь номером телефона.
Отправьте его в следующем сообщении.

⚠️ За 24 часа до визита мы попросим подтвердить запись.
Если не подтвердить ее в течение 2 часов после напоминания, запись автоматически снимется.`,
    );
  }

  return ctx.editMessageText(
    `🎉 Отлично!

💖 Услуга: ${service.name}
📅 Дата: ${date}
🕒 Время: ${time}-${endTime}
⏱ Длительность: ${formatDuration(service.durationMinutes)}

⚠️ За 24 часа до визита мы попросим подтвердить запись.
Если не подтвердить ее в течение 2 часов после напоминания, запись автоматически снимется.

⏳ Подтверди создание записи`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Подтвердить запись",
              callback_data: `confirm_booking_${date}_${time}_${serviceId}`,
            },
          ],
          [
            {
              text: "⬅️ Выбрать другое время",
              callback_data: `select_date_${date}_${serviceId}`,
            },
          ],
        ],
      },
    },
  );
});

bot.action(/^confirm_booking_([^_]+)_([^_]+)_([a-fA-F0-9]{24})$/, async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return ctx.answerCbQuery("Ошибка при загрузке профиля");
  }

  const date = ctx.match[1];
  const time = ctx.match[2];
  const serviceId = ctx.match[3];

  if (!date || !time || !serviceId) {
    return;
  }

  const service = await getServiceById(serviceId);

  if (!service) {
    return ctx.answerCbQuery("Не удалось найти услугу");
  }

  if (calendar[date]?.isBlocked) {
    await ctx.answerCbQuery("Этот день закрыт для записи");
    const { year, month } = getYearMonthFromDate(date);
    return editUserCalendar(ctx, serviceId, year, month);
  }

  if (!isSlotAvailable(date, time, service)) {
    await ctx.answerCbQuery("Слот уже занят, выбери другое время");
    return editTimeSelection(ctx, date, serviceId);
  }

  if (!user.phoneNumber) {
    await ctx.answerCbQuery("Ошибка: номер телефона не сохранен");
    return ctx.reply("Пожалуйста, попробуйте снова.");
  }

  const appointmentAt = getDateFromDateAndTime(date, time);
  const startMinutes = parseTimeToMinutes(time);
  const endMinutes = startMinutes + service.durationMinutes;
  const endTime = formatMinutesToTime(endMinutes);
  const endAt = getDateFromDateAndTime(date, endTime);

  const booking = await BookingModel.create({
    userId: user._id,
    serviceId: service._id,
    appointmentDate: date,
    appointmentAt,
    endAt,
    startTime: time,
    endTime,
    startMinutes,
    endMinutes,
    status: "scheduled",
  });

  await scheduleBookingConfirmation(booking.id, appointmentAt);
  await notifyAdminsAboutBooking(booking, user, service);

  await ctx.answerCbQuery("✅ Запись подтверждена");

  return ctx.editMessageText(
    `✅ Запись создана!

💖 Услуга: ${service.name}
📅 Дата: ${date}
🕒 Время: ${time}-${endTime}
⏱ Длительность: ${formatDuration(service.durationMinutes)}

⏰ За 24 часа до визита мы отправим запрос на подтверждение.
Если не подтвердить запись в течение 2 часов после напоминания, она автоматически снимется.

До встречи ✨`,
  );
});

bot.action(/^confirm_visit_([a-fA-F0-9]{24})$/, async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  const bookingId = ctx.match[1];

  if (!bookingId) {
    return;
  }

  const booking = await BookingModel.findById(bookingId).populate("serviceId");

  if (!booking) {
    return ctx.answerCbQuery("Запись не найдена");
  }

  if (booking.status === "cancelled") {
    return ctx.answerCbQuery("Эта запись уже отменена");
  }

  if (booking.status === "confirmed") {
    return ctx.answerCbQuery("Запись уже подтверждена");
  }

  if (!booking.userId.equals(user._id)) {
    return ctx.answerCbQuery("Нельзя подтверждать чужую запись");
  }

  booking.status = "confirmed";
  booking.confirmedAt = new Date();
  await booking.save();

  const service = booking.serviceId as any;

  await ctx.answerCbQuery("✅ Визит подтвержден");

  return ctx.editMessageText(
    `✅ Визит подтвержден!

💖 Услуга: ${service?.name ?? "Услуга"}
📅 Дата: ${booking.appointmentDate}
🕒 Время: ${booking.startTime}-${booking.endTime}

Ждем вас ✨`,
  );
});

bot.action(/^cancel_booking_([a-fA-F0-9]{24})$/, async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  const bookingId = ctx.match[1];

  if (!bookingId) {
    return;
  }

  const booking = await BookingModel.findById(bookingId).populate("serviceId");

  if (!booking) {
    return ctx.answerCbQuery("Запись не найдена");
  }

  if (!booking.userId.equals(user._id)) {
    return ctx.answerCbQuery("Нельзя отменять чужую запись");
  }

  if (booking.status === "cancelled") {
    await ctx.answerCbQuery("Запись уже отменена");
    const view = await buildUserBookingsView(user._id);

    return ctx.editMessageText(view.text, {
      ...(view.reply_markup ? { reply_markup: view.reply_markup } : {}),
    });
  }

  booking.status = "cancelled";
  booking.cancelledAt = new Date();
  booking.cancellationReason = "Запись отменена пользователем";
  await booking.save();

  const service = booking.serviceId as any;
  await notifyAdminsAboutCancelledBooking(booking, user, service);
  await ctx.answerCbQuery("✅ Запись отменена");

  const view = await buildUserBookingsView(user._id);

  return ctx.editMessageText(
    `✅ Запись на ${booking.appointmentDate} ${booking.startTime}-${booking.endTime} отменена.\n\n${view.text}`,
    {
      ...(view.reply_markup ? { reply_markup: view.reply_markup } : {}),
    },
  );
});

bot.action(/^busy_time_([^_]+)_([^_]+)$/, async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  const date = ctx.match[1];
  const time = ctx.match[2];

  if (!date || !time) {
    return;
  }

  return ctx.answerCbQuery(`Время ${time} на ${date} уже занято`);
});

bot.action("back_to_services", async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  await ctx.answerCbQuery();

  return ctx.editMessageText(
    getServiceSelectionText(),
    await getServiceSelectionKeyboard(),
  );
});

bot.action("my_records", async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  await ctx.answerCbQuery();
  const view = await buildUserBookingsView(user._id);

  return ctx.reply(view.text, {
    ...(view.reply_markup ? { reply_markup: view.reply_markup } : {}),
  });
});

bot.action("services", async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  await ctx.answerCbQuery();

  const services = await getActiveServices();

  if (services.length === 0) {
    return ctx.reply("💖 Сейчас услуги не настроены.");
  }

  const lines = services.map(
    (service: any) =>
      `${service.name} — ${service.price} • ${formatDuration(service.durationMinutes)}`,
  );

  return ctx.reply(`💖 Наши услуги и цены:\n\n${lines.join("\n")}`);
});

bot.action("contacts", async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  await ctx.answerCbQuery();

  return ctx.reply("📍 Контакты и адрес:\n\nМы всегда на связи 📞✨");
});

bot.action("help", async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  await ctx.answerCbQuery();

  if (!config.SUPPORT_URL) {
    return ctx.reply(
      "🆘 Помощь:\n\nЕсли есть вопросы — мы с радостью поможем 💬",
    );
  }

  return ctx.reply(
    "🆘 Помощь:\n\nЕсли есть вопросы — свяжитесь с нами по ссылке ниже 💬",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📞 Служба поддержки",
              url: config.SUPPORT_URL,
            },
          ],
        ],
      },
    },
  );
});

bot.action("portfolio", async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  await ctx.answerCbQuery();

  if (!config.PORTFOLIO_URL) {
    return ctx.reply(
      "🖼 Портфолио:\n\nПосмотрите наши работы и вдохновитесь 🌟",
    );
  }

  return ctx.reply(
    "🖼 Портфолио:\n\nПосмотрите наши работы и вдохновитесь 🌟",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📸 Наш Telegram канал",
              url: config.PORTFOLIO_URL,
            },
          ],
        ],
      },
    },
  );
});

const openAdminPanel = async (ctx: any) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  if (!user.isAdmin) {
    return ctx.reply("⛔ Доступ только для администратора");
  }

  return ctx.reply(
    "👨‍💼 Админ-панель\n\nВыберите действие:",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📅 Календарь (рабочие дни)",
              callback_data: "admin_calendar_open",
            },
          ],
          [
            {
              text: "🧾 Список услуг",
              callback_data: "admin_services_list",
            },
          ],
          [
            {
              text: "🕒 Рабочий день",
              callback_data: "admin_workday_settings",
            },
          ],
          [
            {
              text: "� Контакты и адрес",
              callback_data: "admin_contacts_settings",
            },
          ],
          [
            {
              text: "�🗑 Удалить услугу",
              callback_data: "admin_service_delete_menu",
            },
          ],
          [
            {
              text: "➕ Добавить услугу",
              callback_data: "admin_service_add",
            },
          ],
          [
            {
              text: "ℹ️ Инструкция",
              callback_data: "admin_help",
            },
          ],
        ],
      },
    },
  );
};

bot.command("admin", openAdminPanel);
bot.hears("Админ-панель", openAdminPanel);

bot.action("admin_calendar_open", async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  if (!user.isAdmin) {
    return ctx.answerCbQuery("⛔ Доступ только для администратора");
  }

  const state = getMonthState(0);

  await ctx.answerCbQuery();

  return ctx.editMessageText(
    "📅 Админ-календарь\n\n🟢 — открыт день\n🔴 — закрыт день\n\nНажми на дату, чтобы переключить статус",
    {
      reply_markup: {
        inline_keyboard: buildDate(state.year, state.month, "admin"),
      },
    },
  );
});

bot.action("admin_services_list", async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  if (!user.isAdmin) {
    return ctx.answerCbQuery("⛔ Доступ только для администратора");
  }

  await ctx.answerCbQuery();

  const services = await ServiceModel.find().sort({ createdAt: 1 }).lean();

  if (services.length === 0) {
    return ctx.reply("🧾 Услуги еще не добавлены.");
  }

  const lines = services.map(
    (service: any, index) =>
      `${index + 1}. ${service.name} — ${service.price} • ${formatDuration(service.durationMinutes)} • ${service.isActive ? "активна" : "скрыта"}`,
  );

  return ctx.reply(`🧾 Список услуг:\n\n${lines.join("\n")}`);
});

bot.action("admin_workday_settings", async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  if (!user.isAdmin) {
    return ctx.answerCbQuery("⛔ Доступ только для администратора");
  }

  await ctx.answerCbQuery();

  return ctx.reply(await buildWorkdaySettingsText(), {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Изменить рабочий день",
            callback_data: "admin_workday_change",
          },
        ],
      ],
    },
  });
});

bot.action("admin_workday_change", async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  if (!user.isAdmin) {
    return ctx.answerCbQuery("⛔ Доступ только для администратора");
  }

  pendingActions.set(user.telegramId, { type: "awaiting_workday_input" });

  await ctx.answerCbQuery();

  return ctx.reply(await buildWorkdaySettingsText());
});

bot.action("admin_contacts_settings", async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  if (!user.isAdmin) {
    return ctx.answerCbQuery("⛔ Доступ только для администратора");
  }

  await ctx.answerCbQuery();

  return ctx.reply(buildContactsSettingsText(), {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Изменить контакты",
            callback_data: "admin_contacts_change",
          },
        ],
      ],
    },
  });
});

bot.action("admin_contacts_change", async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  if (!user.isAdmin) {
    return ctx.answerCbQuery("⛔ Доступ только для администратора");
  }

  pendingActions.set(user.telegramId, { type: "awaiting_contacts_input" });

  await ctx.answerCbQuery();

  return ctx.reply(buildContactsSettingsText());
});

bot.action("admin_service_delete_menu", async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  if (!user.isAdmin) {
    return ctx.answerCbQuery("⛔ Доступ только для администратора");
  }

  await ctx.answerCbQuery();

  const view = await buildAdminServiceDeleteView();

  return ctx.reply(view.text, {
    ...(view.reply_markup ? { reply_markup: view.reply_markup } : {}),
  });
});

bot.action(/^admin_service_delete_([a-fA-F0-9]{24})$/, async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  if (!user.isAdmin) {
    return ctx.answerCbQuery("⛔ Доступ только для администратора");
  }

  const serviceId = ctx.match[1];

  if (!serviceId) {
    return;
  }

  const service = await ServiceModel.findById(serviceId);

  if (!service || !service.isActive) {
    await ctx.answerCbQuery("Услуга уже удалена или не найдена");
    const view = await buildAdminServiceDeleteView();

    return ctx.editMessageText(view.text, {
      ...(view.reply_markup ? { reply_markup: view.reply_markup } : {}),
    });
  }

  service.isActive = false;
  await service.save();

  await ctx.answerCbQuery("✅ Услуга удалена из активных");

  const view = await buildAdminServiceDeleteView();

  return ctx.editMessageText(
    `✅ Услуга "${service.name}" скрыта из записи.\n\n${view.text}`,
    {
      ...(view.reply_markup ? { reply_markup: view.reply_markup } : {}),
    },
  );
});

bot.action("admin_service_add", async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  if (!user.isAdmin) {
    return ctx.answerCbQuery("⛔ Доступ только для администратора");
  }

  pendingActions.set(user.telegramId, { type: "awaiting_service_input" });

  await ctx.answerCbQuery();

  return ctx.reply(
    "➕ Отправьте новую услугу в формате:\n\nНазвание | Цена | Длительность в минутах\n\nПример:\nЛаминирование ресниц | 1800 руб. | 90",
  );
});

bot.action("admin_help", async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  if (!user.isAdmin) {
    return ctx.answerCbQuery("⛔ Доступ только для администратора");
  }

  await ctx.answerCbQuery();

  return ctx.reply(
    "ℹ️ Инструкция для администратора:\n\n1. Кнопка `Админ-панель` доступна только пользователям с `isAdmin=true`.\n2. Через панель можно открыть календарь рабочих дней, настроить начало и конец рабочего дня и управлять услугами.\n3. Новые услуги отправляются сообщением в формате `Название | Цена | Длительность в минутах`.\n4. Рабочий день изменяется сообщением в формате `HH:MM | HH:MM`.",
    { parse_mode: "Markdown" },
  );
});

bot.action(/^admin_toggle_([^_]+)$/, async (ctx) => {
  const user = await ensureRegisteredWithPhone(ctx);

  if (!user) {
    return;
  }

  if (!user.isAdmin) {
    return ctx.answerCbQuery("⛔ Доступ только для администратора");
  }

  const date = ctx.match[1];

  if (!date) {
    return;
  }

  const { year, month } = getYearMonthFromDate(date);

  if (!calendar[date]) {
    calendar[date] = { isBlocked: false };
  }

  calendar[date].isBlocked = !calendar[date].isBlocked;

  await ctx.answerCbQuery(
    calendar[date].isBlocked ? "🔴 День закрыт" : "🟢 День открыт",
  );

  return ctx.editMessageReplyMarkup({
    inline_keyboard: buildDate(year, month, "admin"),
  });
});

bot.on(message("text"), async (ctx, next) => {
  const user = await getRegisteredUser(ctx.from?.id);

  if (!user) {
    return next();
  }

  const pendingAction = pendingActions.get(user.telegramId);

  if (!pendingAction) {
    return next();
  }

  if (!user.isAdmin && pendingAction.type !== "awaiting_phone_for_booking") {
    pendingActions.delete(user.telegramId);
    return next();
  }

  if (ctx.message.text === "Админ-панель") {
    return next();
  }

  if (pendingAction.type === "awaiting_contacts_input") {
    const parts = ctx.message.text.split("|").map((part) => part.trim());

    if (parts.length < 1 || parts.length > 2) {
      return ctx.reply(
        "Неверный формат. Используйте:\nТелефон | Адрес\n\nАдрес является опциональным полем.\n\nПример:\n+7 (999) 123-45-67 | Москва, ул. Примерная, 1",
      );
    }

    const [phone, address] = parts;

    if (!phone) {
      return ctx.reply(
        "Телефон обязателен. Используйте формат:\nТелефон | Адрес",
      );
    }

    // Update environment variables in memory
    (config as any).CONTACT_PHONE = phone;
    (config as any).ADDRESS = address || "";

    pendingActions.delete(user.telegramId);

    return ctx.reply(
      `✅ Контакты обновлены:\n\nТелефон: ${phone}\nАдрес: ${address || "не указан"}`,
    );
  }

  if (pendingAction.type === "awaiting_workday_input") {
    const parts = ctx.message.text.split("|").map((part) => part.trim());

    if (parts.length !== 2) {
      return ctx.reply(
        "Неверный формат. Используйте:\nHH:MM | HH:MM\n\nПример:\n10:00 | 18:00",
      );
    }

    const [startTime, endTime] = parts;

    if (!startTime || !endTime) {
      return ctx.reply(
        "Неверный формат. Используйте:\nHH:MM | HH:MM\n\nПример:\n10:00 | 18:00",
      );
    }

    if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) {
      return ctx.reply(
        "Время должно быть в формате HH:MM.\n\nПример:\n10:00 | 18:00",
      );
    }

    const startMinutes = parseTimeToMinutes(startTime);
    const endMinutes = parseTimeToMinutes(endTime);

    if (
      Number.isNaN(startMinutes) ||
      Number.isNaN(endMinutes) ||
      startMinutes >= endMinutes
    ) {
      return ctx.reply("Проверьте диапазон: начало рабочего дня должно быть раньше конца.");
    }

    await AppSettingsModel.findOneAndUpdate(
      { key: "default" },
      {
        $set: {
          workdayStartMinutes: startMinutes,
          workdayEndMinutes: endMinutes,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );

    pendingActions.delete(user.telegramId);

    return ctx.reply(
      `✅ Рабочий день обновлен:\n\nНачало: ${formatMinutesToTime(startMinutes)}\nКонец: ${formatMinutesToTime(endMinutes)}`,
    );
  }

  if (pendingAction.type === "awaiting_phone_for_booking") {
    const phonePattern = /^\+?[\d\s\-()]{10,}$/;
    if (!phonePattern.test(ctx.message.text)) {
      return ctx.reply("Пожалуйста, отправьте корректный номер телефона.");
    }

    user.phoneNumber = ctx.message.text;
    await user.save();

    const { bookingData } = pendingAction;
    pendingActions.delete(user.telegramId);

    const service = await getServiceById(bookingData.serviceId);
    if (!service) {
      return ctx.reply("Ошибка при создании записи.");
    }

    const appointmentAt = getDateFromDateAndTime(
      bookingData.date,
      bookingData.time,
    );
    const startMinutes = parseTimeToMinutes(bookingData.time);
    const endMinutes = startMinutes + service.durationMinutes;
    const endTime = formatMinutesToTime(endMinutes);
    const endAt = getDateFromDateAndTime(bookingData.date, endTime);

    const booking = await BookingModel.create({
      userId: user._id,
      serviceId: service._id,
      appointmentDate: bookingData.date,
      appointmentAt,
      endAt,
      startTime: bookingData.time,
      endTime,
      startMinutes,
      endMinutes,
      status: "scheduled",
    });

    await scheduleBookingConfirmation(booking.id, appointmentAt);
    await notifyAdminsAboutBooking(booking, user, service);

    return ctx.editMessageText(
      `✅ Запись создана!

💖 Услуга: ${service.name}
📅 Дата: ${bookingData.date}
🕒 Время: ${bookingData.time}-${endTime}
⏱ Длительность: ${formatDuration(service.durationMinutes)}

⏰ За 24 часа до визита мы отправим запрос на подтверждение.
Если не подтвердить запись в течение 2 часов после напоминания, она автоматически снимется.

До встречи ✨`,
    );
  }

  const parts = ctx.message.text.split("|").map((part) => part.trim());

  if (parts.length !== 3) {
    return ctx.reply(
      "Неверный формат. Используйте:\nНазвание | Цена | Длительность в минутах",
    );
  }

  const [name, price, durationText] = parts;
  const durationMinutes = Number(durationText);

  if (!name || !price || !Number.isFinite(durationMinutes) || durationMinutes < 15) {
    return ctx.reply(
      "Проверьте данные. Длительность должна быть числом в минутах и не меньше 15.",
    );
  }

  await ServiceModel.create({
    name,
    price,
    durationMinutes,
    isActive: true,
  });

  pendingActions.delete(user.telegramId);

  return ctx.reply(
    `✅ Услуга добавлена:\n\n${name} — ${price} • ${formatDuration(durationMinutes)}`,
  );
});

bot.action("noop", (ctx) => ctx.answerCbQuery());

const bootstrap = async () => {
  assertConfig();
  await connectMongo();
  await ensureDefaultAppSettings();
  await ensureDefaultServices();
  startBookingQueueWorker(bot);
  await bot.launch();
};

const shutdown = async (signal: string) => {
  console.log(`Stopping bot (${signal})...`);
  bot.stop(signal);
  await closeBookingQueue();
  await closeRedis();
  await disconnectMongo();
  process.exit(0);
};

bootstrap().catch((error) => {
  console.error("Failed to start bot", error);
  process.exit(1);
});

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
