import mongoose from "mongoose";
import { config } from "../config/config.js";

let isConnected = false;

export const connectMongo = async () => {
  if (isConnected) {
    return mongoose;
  }

  await mongoose.connect(config.MONGODB_URI);
  isConnected = true;

  return mongoose;
};

export const disconnectMongo = async () => {
  if (!isConnected) {
    return;
  }

  await mongoose.disconnect();
  isConnected = false;
};
