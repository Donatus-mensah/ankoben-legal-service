const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();

app.use(cors({
    origin: '*' // Allows your frontend to communicate with this backend
}));
app.use(express.json());

// These keys will be hidden safely inside Render's dashboard
const ARKESEL_API_KEY = process.env.ARKESEL_API_KEY;
const EMAIL_USER = process.env.EMAIL_USER; 
const EMAIL_PASS = process.env.EMAIL_PASS; // Using Yahoo App Password
const COUNSEL_EMAIL = process.env.COUNSEL_EMAIL;

// Configure Nodemailer for Yahoo
const transporter = nodemailer.createTransport({
    service: 'yahoo',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    }
});

app.post('/api/notify-consultation', async (req, res) => {
    const { 
        first_name, last_name, email, phone, 
        practice_area, consultation_type, issue_description 
    } = req.body;

    try {
        // 1. Send Generic Receipt SMS to Client via Arkesel
        const smsMessage = `Hello ${first_name}, your ${consultation_type} consultation request has been received by Akoben Legal Services. We will contact you shortly to confirm your appointment date and time.`;
        
        await axios.post('https://sms.arkesel.com/api/v2/sms/send', {
            sender: 'AKOBEN', 
            message: smsMessage,
            recipients: [phone]
        }, {
            headers: { 'api-key': ARKESEL_API_KEY }
        });

        // 2. Send Immediate Email Alert to Counsel
        const mailOptions = {
            from: EMAIL_USER,
            to: COUNSEL_EMAIL,
            subject: `URGENT: New ${consultation_type} Consultation Booking - ${first_name} ${last_name}`,
            text: `You have a new consultation booking awaiting scheduling.\n\nDetails:\nName: ${first_name} ${last_name}\nEmail: ${email}\nPhone: ${phone}\nPractice Area: ${practice_area}\nType: ${consultation_type}\n\nClient's Issue/Notes:\n${issue_description}\n\nPlease reach out to the client to schedule the date and time. If this is a Virtual meeting, generate a Zoom link and provide it to them.`
        };
        
        await transporter.sendMail(mailOptions);

        res.status(200).json({ success: true, message: 'Notifications deployed securely.' });
    } catch (error) {
        console.error('Notification Error:', error?.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Failed to process notifications' });
    }
});

app.post('/api/notify-contact', async (req, res) => {
    const { name, email, subject, message } = req.body;

    try {
        // 1. Send Auto-Reply Feedback Email TO THE CLIENT
        const clientFeedbackMail = {
            from: EMAIL_USER,
            to: email, // Sending to the person who filled the form
            subject: `Request Received: ${subject}`,
            text: `Hello ${name},\n\nThank you for contacting Akoben Legal Services. We have successfully received your inquiry regarding "${subject}".\n\nA member of our team or Counsel will review your message and get back to you as soon as possible.\n\nBest Regards,\nAkoben Legal Services\nnyogyasi@yahoo.com`
        };
        await transporter.sendMail(clientFeedbackMail);

        // 2. Forward the actual message TO COUNSEL
        const counselAlertMail = {
            from: EMAIL_USER,
            to: COUNSEL_EMAIL,
            subject: `Website Inquiry: ${subject}`,
            text: `You have received a new general inquiry from the website.\n\nFrom: ${name}\nEmail: ${email}\nSubject: ${subject}\n\nMessage:\n${message}`
        };
        await transporter.sendMail(counselAlertMail);

        res.status(200).json({ success: true, message: 'Contact emails sent successfully.' });
    } catch (error) {
        console.error('Contact Notification Error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to process contact emails' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Akoben Backend is running securely on port ${PORT}`);
});