export interface EmailHeadersDTO {
  ccEmails?: Array<string>
  fromEmail?: string
  fromName?: string
  preheader?: string
  replyEmail?: string
  subject: string
}
