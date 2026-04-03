import type { Author } from "next/dist/lib/metadata/types/metadata-types";

export const PHONE = "+20 105 578 2533"; // Leave as is
export const VFCASH = "01003993559"; // Change to Vodafone Cash number
export const TELDA = "@alykotb"; // Change to Telda username
export const IPN = "01012988103"; // Change to Instapay details

export const INDIVIDUAL_TICKET_PRICE = 450; // Change to individual ticket price
export const GROUP_TICKET_PRICE = 375; // Change to group ticket price per person
export const TEACHER_TICKET_PRICE = 350; // Change to teacher ticket price

export const DISCOUNTED_TICKET_PRICE = 400; // Change to rush hour ticket price

export const INDIVIDUAL_EARLY_PRICE = 400; // Change to early bird individual ticket price
export const GROUP_EARLY_PRICE = 375; // Change to early bird group ticket price per person

export const TICKET_WINDOW = [
  new Date("2026-01-03T22:00:00Z"), // 2026-01-04 00:00 GMT+2
  new Date("2026-02-13T06:00:00Z"), // 2026-02-13 08:00 GMT+2
]; // Change to actual ticket window
export const EARLY_BIRD_UNTIL: Date | null = new Date("2026-01-12T22:00:00Z"); // Change to actual early bird deadline or null if not applicable

export const EVENT_DATE = new Date("2026-02-13T23:59:59Z"); // Change to event date end
export const HOST = "https://tedxbedayia.com";

export const EVENT_DESC =
  "The event will be held on Friday, 13th of February, 2026 from 3 P.M. to 10 P.M. at Bedayia International School. Entry will be from Gate #2."; // Change to event description

export const YEAR = 26; // Increment for each event

export const SPEAKER_FREE_TICKETS = 2; // Change to default number of free tickets

export const support: Author = {
  name: "Aly Mobarak",
  url: "mailto:alymmobarak@hotmail.com",
};

export const paymentProcessor = "Telda, Instapay, and eWallet"; // Change to payment processor name
