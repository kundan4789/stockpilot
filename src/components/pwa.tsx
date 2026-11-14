"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/sw.js`).catch(() => {});
  }, []);
  return null;
}

/** Shows browser notifications for new unread alerts while the app is open (free; no push service). */
export async function notify(title: string, body: string, url = "/alerts/") {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) reg.showNotification(title, { body, icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icons/icon-192.png`, data: { url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${url}` } });
  else new Notification(title, { body });
}
