import mongoose, { Schema, model, type Model } from "mongoose";

const bookingSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    serviceId: {
      type: Schema.Types.ObjectId,
      ref: "Service",
      required: true,
    },
    appointmentDate: {
      type: String,
      required: true,
      index: true,
    },
    appointmentAt: {
      type: Date,
      required: true,
      index: true,
    },
    endAt: {
      type: Date,
      required: true,
    },
    startTime: {
      type: String,
      required: true,
    },
    endTime: {
      type: String,
      required: true,
    },
    startMinutes: {
      type: Number,
      required: true,
    },
    endMinutes: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["scheduled", "awaiting_confirmation", "confirmed", "cancelled"],
      default: "scheduled",
      index: true,
    },
    confirmationRequestedAt: {
      type: Date,
      default: null,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancellationReason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

export const BookingModel: Model<any> =
  (mongoose.models.Booking as Model<any> | undefined) || model("Booking", bookingSchema);
