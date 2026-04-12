import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function relativeTime(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/**
 * Removes null, undefined, and empty string values from an object
 * This prevents validation errors when sending partial updates to the API
 * @param data - Object to clean
 * @returns New object with only defined, non-empty values
 */
export function cleanFormData<T extends Record<string, any>>(data: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(data).filter(([_, value]) => {
      // Keep false and 0 as they are valid values
      if (value === false || value === 0) return true;
      // Remove null, undefined, and empty strings
      return value !== null && value !== undefined && value !== '';
    })
  ) as Partial<T>;
}
