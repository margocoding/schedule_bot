import { Schema, model, type Model } from "mongoose";
import {
  DEFAULT_WORKDAY_END_MINUTES,
  DEFAULT_WORKDAY_START_MINUTES,
} from "../utils/schedule.js";
import mongoose from "mongoose";

const appSettingsSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    workdayStartMinutes: {
      type: Number,
      default: DEFAULT_WORKDAY_START_MINUTES,
    },
    workdayEndMinutes: {
      type: Number,
      default: DEFAULT_WORKDAY_END_MINUTES,
    },
  },
  {
    timestamps: true,
  },
);

export const AppSettingsModel: Model<any> =
  (mongoose.models.AppSettings as Model<any> | undefined) ||
  model("AppSettings", appSettingsSchema);
