import mongoose from "mongoose";
import { Schema, model, type Model } from "mongoose";

const serviceSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: String,
      required: true,
      trim: true,
    },
    durationMinutes: {
      type: Number,
      required: true,
      min: 15,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

export const ServiceModel: Model<any> =
  (mongoose.models.Service as Model<any> | undefined) || model("Service", serviceSchema);
