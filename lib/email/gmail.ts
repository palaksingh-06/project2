import { gmail as gmailApi, auth } from "@googleapis/gmail";
import MailComposer from "nodemailer/lib/mail-composer";

const DEFAULT_SENDER = "anil.kumar.giit123@gmail.com";

export function isMailConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GMAIL_REFRESH_TOKEN
  );
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  const sender = process.env.MAIL_FROM_ADDRESS || DEFAULT_SENDER;

  const message = await new MailComposer({
    from: `PriceMyTrip <${sender}>`,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  })
    .compile()
    .build();

  const raw = message
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const oauth2Client = new auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
  });

  await gmailApi({ version: "v1", auth: oauth2Client }).users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
}