// src/device.ts

export type DeviceType = 'desktop' | 'tablet' | 'phone';

// Function to detect device type using user-agent
export function getDeviceType(): DeviceType {
  const userAgent = navigator.userAgent.toLowerCase();

  if (/mobile|android|iphone|ipad|tablet/.test(userAgent)) {
    if (/ipad|tablet/.test(userAgent)) {
      return 'tablet';
    } else {
      return 'phone';
    }
  } else {
    return 'desktop';
  }
}