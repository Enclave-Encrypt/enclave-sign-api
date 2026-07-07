export type RecipientStatus = "pending" | "signed" | "declined";

export function deriveEnvelopeStatus(
  recipientStatuses: RecipientStatus[],
): "sent" | "waiting" | "completed" | "voided" {
  if (recipientStatuses.some((status) => status === "declined")) {
    return "voided";
  }

  if (recipientStatuses.every((status) => status === "signed")) {
    return "completed";
  }

  if (recipientStatuses.some((status) => status === "signed")) {
    return "waiting";
  }

  return "sent";
}
