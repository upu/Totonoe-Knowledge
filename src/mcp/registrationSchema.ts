import * as z from "zod/v4";
import { knowledgeTypes } from "../knowledge/types";

const maxRegistrationCodePoints = 64 * 1024;

const boundedText = (maximum: number) => z.string().min(1).max(maximum);
const boundedList = (maximumItems: number, maximumItemLength: number) =>
  z.array(boundedText(maximumItemLength)).min(1).max(maximumItems);

export const registrationPayloadSchema = z.object({
  title: boundedText(200),
  summary: boundedText(1_000),
  type: z.enum(knowledgeTypes),
  keywords: boundedList(20, 100),
  conclusion: boundedText(20_000),
  background: boundedText(20_000),
  verified: boundedList(50, 2_000),
  procedure: boundedText(20_000),
  cautions: boundedList(50, 2_000),
  unresolved: boundedList(50, 2_000),
}).strict().superRefine((value, context) => {
  if (Array.from(JSON.stringify(value)).length <= maxRegistrationCodePoints) return;
  context.addIssue({
    code: "custom",
    message: `登録payloadは${maxRegistrationCodePoints}文字以下にしてください。`,
  });
});

export const registerToolInputSchema = z.object({
  previewToken: z.string().min(1).max(200),
  knowledge: registrationPayloadSchema,
}).strict();
