-- Distinguishes who sent an outbound WhatsApp message: the AI ('bot') or a
-- human typing from the WhatsApp Business phone app on a Coexistence-enabled
-- number ('human', recorded from smb_message_echoes). Lets autoReply() go
-- quiet for a while after a human manually answers, instead of talking over
-- them on the customer's next message.
ALTER TABLE whatsapp_messages ADD COLUMN source TEXT DEFAULT NULL;
