const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// BULLETPROOF CORS CONFIGURATION
app.use(cors({
    origin: ['https://akobenlegalservices.com', 'https://www.akobenlegalservices.com', 'https://ankoben-legal-service.vercel.app'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors()); 
app.use(express.json());

// Secure Environment Variables
const ARKESEL_API_KEY = process.env.ARKESEL_API_KEY;
const EMAIL_USER = process.env.EMAIL_USER; 
const EMAIL_PASS = process.env.EMAIL_PASS; 
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; 
const ADMIN_SECRET = process.env.ADMIN_SECRET || '2324';
const CLERK_PHONE = '233577780056'; // Victoria Kotei's Phone Number

// Initialize Supabase Client
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('Supabase client initialized successfully.');
}

// Initialize Nodemailer for Gmail Setup
const transporter = nodemailer.createTransport({
    service: 'gmail', 
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS // Requires Google App Password
    }
});

// Helper Function: Format Ghana Phone Numbers for Arkesel
function formatGhanaNumber(phone) {
    if (!phone) return '';
    let formatted = phone.trim().replace(/[^0-9]/g, '');
    if (formatted.startsWith('0')) {
        formatted = '233' + formatted.substring(1);
    } else if (!formatted.startsWith('233')) {
        formatted = '233' + formatted;
    }
    return formatted;
}

// Helper Function: Format 24hr string to 12hr AM/PM string for exact display
function formatTime12h(timeStr) {
    if (!timeStr) return '';
    let [hours, minutes] = timeStr.split(':');
    hours = parseInt(hours, 10);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; 
    return `${hours}:${minutes} ${ampm}`;
}

// Helper to prevent 'undefined' string bugs in mapping
const safeString = (val, fallback) => (val && val !== 'undefined' && val !== null) ? val : fallback;

// ========================================================
// HEALTH CHECK
// ========================================================
app.get('/', (req, res) => {
    const isConfigured = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS && process.env.ARKESEL_API_KEY && process.env.SUPABASE_KEY);
    
    const htmlResponse = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Akoben Backend Status</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .container { background-color: #1e293b; padding: 3rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; max-width: 500px; width: 90%; border: 1px solid #334155; }
            .status-icon { font-size: 4rem; margin-bottom: 1rem; }
            .live { color: #22c55e; }
            .error { color: #ef4444; }
            h1 { margin-top: 0; font-size: 1.8rem; letter-spacing: 1px; }
            p { color: #94a3b8; line-height: 1.6; }
            .badge { display: inline-block; padding: 0.5rem 1rem; border-radius: 20px; font-weight: bold; font-size: 0.9rem; margin-top: 1.5rem; }
            .badge-live { background-color: rgba(34, 197, 94, 0.1); color: #22c55e; border: 1px solid #22c55e; }
            .badge-error { background-color: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid #ef4444; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="status-icon ${isConfigured ? 'live' : 'error'}">
                ${isConfigured ? '✓' : '⚠️'}
            </div>
            <h1>AKOBEN LEGAL BACKEND</h1>
            <p>The secure API and background task runner for Akoben Legal Services.</p>
            <div class="badge ${isConfigured ? 'badge-live' : 'badge-error'}">
                ${isConfigured ? 'STATUS: LIVE & SECURE' : 'STATUS: MISSING CONFIGURATION'}
            </div>
            <p style="margin-top: 2rem; font-size: 0.8rem; color: #475569;">© ${new Date().getFullYear()} Akoben Legal Services</p>
        </div>
    </body>
    </html>
    `;
    res.send(htmlResponse);
});

// ========================================================
// 1. AUTHENTICATION & FULL CLIENT FETCH ROUTE
// ========================================================
app.post('/api/verify-counsel', async (req, res) => {
    const { passcode } = req.body;

    if (passcode !== ADMIN_SECRET) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Counsel Passcode.' });
    }

    try {
        let clients = [];
        if (supabase) {
            const { data, error } = await supabase
                .from('consultations')
                // Include zoom_link in the fetch query
                .select('id, first_name, last_name, phone, email, booking_ref, status, appointment_date, appointment_time, practice_area, consultation_type, issue_description, zoom_link, created_at')
                .order('created_at', { ascending: false });

            if (!error && data) {
                clients = data.map(client => ({
                    id: client.id,
                    name: `${safeString(client.first_name, '')} ${safeString(client.last_name, '')}`.trim() || 'Unknown Client',
                    first_name: safeString(client.first_name, ''),
                    last_name: safeString(client.last_name, ''),
                    phone: safeString(client.phone, 'N/A'),
                    email: safeString(client.email, 'N/A'),
                    ref: safeString(client.booking_ref, 'PENDING'),
                    status: safeString(client.status, 'Pending'),
                    appointment_date: client.appointment_date || null,
                    appointment_time: client.appointment_time || null,
                    practice_area: safeString(client.practice_area, 'General'),
                    consultation_type: safeString(client.consultation_type, 'In-Person'),
                    issue_description: safeString(client.issue_description, ''),
                    zoom_link: safeString(client.zoom_link, ''),
                    created_at: client.created_at
                }));
            }
        }
        res.status(200).json({ success: true, clients });
    } catch (err) {
        console.error('Verify Counsel Error:', err.message);
        res.status(500).json({ success: false, error: 'Database query error.' });
    }
});

// ========================================================
// 2. SECURE PUBLICATION ENDPOINT (WITH MEDIA URL)
// ========================================================
app.post('/api/publish-article', async (req, res) => {
    const { author, passcode, title, content, media_type, media_url } = req.body;

    if (passcode !== ADMIN_SECRET) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Counsel Passcode.' });
    }

    try {
        if (!supabase) throw new Error('Database is not configured correctly on Render.');

        const { data, error } = await supabase
            .from('publications')
            .insert([{ title, content, author, media_type, media_url }])
            .select();

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Article published successfully to database', data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========================================================
// 3. SCHEDULE CONSULTATION (SMS & SET CONFIRMED STATUS)
// ========================================================
app.post('/api/schedule-consultation', async (req, res) => {
    const { passcode, id, date, time, zoom_link } = req.body;

    if (passcode !== ADMIN_SECRET) return res.status(401).json({ success: false, error: 'Unauthorized.' });
    if (!id || !date || !time) return res.status(400).json({ success: false, error: 'Missing parameters.' });

    try {
        if (!supabase) throw new Error('Database is not connected.');

        // Update status to Confirmed and include the zoom_link
        const { data: updatedRecord, error: updateError } = await supabase
            .from('consultations')
            .update({ appointment_date: date, appointment_time: time, status: 'Confirmed', zoom_link: zoom_link || null })
            .eq('id', id)
            .select()
            .single();

        if (updateError) throw updateError;

        const clientName = `${updatedRecord.first_name} ${updatedRecord.last_name}`;
        const formattedDate = new Date(date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const formattedPhone = formatGhanaNumber(updatedRecord.phone);
        const refCode = updatedRecord.booking_ref || 'CONFIRMED';
        
        // Convert the 24hr time selected to 12hr format with AM/PM for SMS readability
        const time12h = formatTime12h(time);

        // Conditional SMS to Client (Includes zoom link if Virtual)
        if (ARKESEL_API_KEY) {
            let smsMessage = `Hello ${updatedRecord.first_name}, your consultation with Akoben Legal Services (Ref:${refCode}) is confirmed for ${formattedDate} at ${time12h}. Please arrive on time.`;
            
            if (updatedRecord.consultation_type === 'Virtual') {
                smsMessage = `Hello ${updatedRecord.first_name}, your Virtual consultation (Ref:${refCode}) is confirmed for ${formattedDate} at ${time12h}. Meeting Link: ${zoom_link}. Please join on time.`;
            }

            await axios.post('https://sms.arkesel.com/api/v2/sms/send', {
                sender: 'AKOBEN', message: smsMessage, recipients: [formattedPhone]
            }, { headers: { 'api-key': ARKESEL_API_KEY, 'Content-Type': 'application/json' } })
            .catch(err => console.error('Arkesel SMS Schedule error:', err?.response?.data || err.message));
        }

        // Email Alert to Counsel and Client upon scheduling
        if (EMAIL_USER && EMAIL_PASS) {
            try {
                // Email to Counsel to notify them that they have set the schedule
                const adminMailOptions = {
                    from: EMAIL_USER,
                    to: 'akobenlegalservices@gmail.com',
                    subject: `[${refCode}] Booking Confirmed - ${clientName}`,
                    text: `Hello Counsel,\n\nYou have successfully scheduled and confirmed the consultation for ${clientName}.\n\nDate: ${formattedDate}\nTime: ${time12h}\nType: ${updatedRecord.consultation_type}\nReference: ${refCode}${updatedRecord.consultation_type === 'Virtual' ? '\nZoom Link: ' + zoom_link : ''}\n\nThe client has been notified via SMS.`
                };
                await transporter.sendMail(adminMailOptions);
                
                // Email to Client (if they provided an email address)
                if (updatedRecord.email && updatedRecord.email !== 'N/A') {
                    let clientMailText = `Hello ${updatedRecord.first_name},\n\nYour consultation with Akoben Legal Services (Ref: ${refCode}) is confirmed for ${formattedDate} at ${time12h}.\n\nPlease arrive on time.\n\nBest Regards,\nAkoben Legal Services`;
                    
                    if (updatedRecord.consultation_type === 'Virtual') {
                        clientMailText = `Hello ${updatedRecord.first_name},\n\nYour Virtual consultation with Akoben Legal Services (Ref: ${refCode}) is confirmed for ${formattedDate} at ${time12h}.\n\nMeeting Link: ${zoom_link}\n\nPlease join on time.\n\nBest Regards,\nAkoben Legal Services`;
                    }

                    const clientMailOptions = {
                        from: EMAIL_USER,
                        to: updatedRecord.email,
                        subject: `Consultation Confirmed - Akoben Legal Services`,
                        text: clientMailText
                    };
                    await transporter.sendMail(clientMailOptions);
                }
            } catch(err) { 
                console.error('Confirmation Email warning:', err.message); 
            }
        }

        res.status(200).json({ success: true, message: `Consultation confirmed and official SMS sent to ${clientName}.` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message || 'Failed to schedule appointment.' });
    }
});

// ========================================================
// 4. MANUAL STATUS UPDATE ENDPOINT (ATTENDANCE & CANCEL SMS)
// ========================================================
app.post('/api/update-consultation-status', async (req, res) => {
    const { passcode, id, status } = req.body;

    if (passcode !== ADMIN_SECRET) return res.status(401).json({ success: false, error: 'Unauthorized.' });

    try {
        if (!supabase) throw new Error('Database is not connected.');
        
        // Update and select the record to get details for SMS
        const { data: updatedRecord, error } = await supabase
            .from('consultations')
            .update({ status: status })
            .eq('id', id)
            .select('first_name, phone, booking_ref')
            .single();
            
        if (error) throw error;

        // If marked as Cancelled (Missed), send an immediate SMS to the client
        if (status === 'Cancelled' && ARKESEL_API_KEY && updatedRecord.phone) {
            setImmediate(async () => {
                try {
                    const formattedPhone = formatGhanaNumber(updatedRecord.phone);
                    const cancelSms = `Hello ${updatedRecord.first_name}, you missed your scheduled legal consultation (Ref:${updatedRecord.booking_ref}). It has been cancelled. You can now rebook a new session on our website when ready.`;
                    
                    await axios.post('https://sms.arkesel.com/api/v2/sms/send', {
                        sender: 'AKOBEN', message: cancelSms, recipients: [formattedPhone]
                    }, { headers: { 'api-key': ARKESEL_API_KEY, 'Content-Type': 'application/json' } });
                } catch(err) {
                    console.log('Cancellation SMS warning:', err.message);
                }
            });
        }

        res.status(200).json({ success: true, message: `Consultation marked as ${status}.` });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update consultation status.' });
    }
});

// ========================================================
// 5. NOTIFICATIONS: Consultations (BACKGROUND PROCESSING)
// ========================================================
app.post('/api/notify-consultation', async (req, res) => {
    const { first_name, last_name, email, phone, practice_area, consultation_type, issue_description } = req.body;
    const bookingId = `AKB-${Math.floor(10000 + Math.random() * 90000)}`;
    const formattedPhone = formatGhanaNumber(phone);

    try {
        if (supabase) {
            // Prevent double booking UNLESS they are marked Completed/Cancelled
            const emailQuery = email ? `email.eq.${email}` : 'email.eq.NONE';
            const phoneQuery = phone ? `phone.eq.${phone}` : 'phone.eq.NONE';
            
            const { data: existingBookings } = await supabase
                .from('consultations')
                .select('*')
                .or(`${emailQuery},${phoneQuery}`)
                .in('status', ['Pending', 'Confirmed']);

            if (existingBookings && existingBookings.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: `You already have an active booking (Status: ${existingBookings[0].status}). Please wait for your consultation or contact us directly.`
                });
            }

            const { error: dbError } = await supabase.from('consultations').insert([{
                first_name, last_name, email, phone, practice_area, consultation_type, issue_description,
                booking_ref: bookingId, status: 'Pending'
            }]);
            
            if (dbError) throw new Error("Database insert failed.");
        }

        res.status(200).json({ success: true, booking_id: bookingId, message: 'Consultation request received.' });

        // Background Processing for Notifications
        setImmediate(async () => {
            if (ARKESEL_API_KEY) {
                // SMS 1: To the Client
                try {
                    const clientSms = `Hello ${first_name}, your consultation request (Ref:${bookingId}) has been received. Our chambers will contact you shortly to confirm your schedule.`;
                    await axios.post('https://sms.arkesel.com/api/v2/sms/send', {
                        sender: 'AKOBEN', message: clientSms, recipients: [formattedPhone]
                    }, { headers: { 'api-key': ARKESEL_API_KEY, 'Content-Type': 'application/json' } });
                } catch(err) { console.log('Background SMS Client warning:', err.message); }

                // SMS 2: To the Legal Clerk (Administrator) - EXACT REQUESTED MESSAGE
                try {
                    const adminSms = `hello Vic, there's being a booked consultation on the website check and confirm for the client.`;
                    await axios.post('https://sms.arkesel.com/api/v2/sms/send', {
                        sender: 'AKOBEN', message: adminSms, recipients: [CLERK_PHONE]
                    }, { headers: { 'api-key': ARKESEL_API_KEY, 'Content-Type': 'application/json' } });
                } catch(err) { console.log('Background SMS Admin warning:', err.message); }
            }

            // Email Notification specifically to Lawyer Gyasi's requested email
            if (EMAIL_USER && EMAIL_PASS) {
                try {
                    const mailOptions = {
                        from: EMAIL_USER, 
                        to: 'akobenlegalservices@gmail.com', // Explicitly sent to requested email
                        subject: `[${bookingId}] New Consultation Booking - ${first_name} ${last_name}`,
                        text: `Hello Lawyer Gyasi, there's being a booking on the website.\n\nBooking Reference: ${bookingId}\nClient: ${first_name} ${last_name}\nPhone: ${phone}\nEmail: ${email}\nArea: ${practice_area}\nType: ${consultation_type}\n\nClient Issue:\n${issue_description}\n\nPlease log in to the Counsel Portal to set an appointment schedule.`
                    };
                    await transporter.sendMail(mailOptions);
                } catch(err) { console.log('Background Email warning:', err.message); }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to record booking request.' });
    }
});

// ========================================================
// 6. NOTIFICATIONS: Contact Form (BACKGROUND PROCESSING)
// ========================================================
app.post('/api/notify-contact', async (req, res) => {
    const { name, email, subject, message } = req.body;

    try {
        if (supabase) await supabase.from('contacts').insert([{ name, email, subject, message }]);
        res.status(200).json({ success: true, message: 'Message sent successfully.' });

        setImmediate(async () => {
            if (EMAIL_USER && EMAIL_PASS) {
                if (email) {
                    transporter.sendMail({
                        from: EMAIL_USER, to: email, 
                        subject: `Inquiry Received: ${subject}`,
                        text: `Hello ${name},\n\nThank you for reaching out to Akoben Legal Services. We have received your message. Counsel will review and respond shortly.\n\nBest Regards,\nAkoben Legal Services`
                    }).catch(err => console.log('Client mailer error:', err.message));
                }
                
                // Route general contact to akobenlegalservices@gmail.com
                transporter.sendMail({
                    from: EMAIL_USER, to: 'akobenlegalservices@gmail.com',
                    subject: `Website Inquiry: ${subject}`,
                    text: `New message from ${name} (${email}):\n\nSubject: ${subject}\n\n${message}`
                }).catch(err => console.log('Counsel mailer error:', err.message));
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to process contact message.' });
    }
});

// ========================================================
// 7. AUTOMATED CRON JOB: 5:00 AM DAILY REMINDERS
// ========================================================
// This runs every day at 5:00 AM (Accra Time). It checks the DB 
// for Confirmed appointments happening today and texts the client.
cron.schedule('0 5 * * *', async () => {
    console.log('Running daily 5:00 AM consultation SMS reminders...');
    if (!supabase || !ARKESEL_API_KEY) return;

    try {
        // Get today's date formatted perfectly to match the HTML Date Input standard (YYYY-MM-DD)
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Accra' });

        const { data: appointments, error } = await supabase
            .from('consultations')
            // Add consultation_type and zoom_link to the query
            .select('first_name, phone, appointment_time, booking_ref, consultation_type, zoom_link')
            .eq('status', 'Confirmed')
            .eq('appointment_date', today);

        if (error) throw error;

        if (appointments && appointments.length > 0) {
            for (const appt of appointments) {
                const formattedPhone = formatGhanaNumber(appt.phone);
                if (formattedPhone) {
                    // Make sure the reminder SMS uses the exact formatted 12h time (AM/PM)
                    const time12h = formatTime12h(appt.appointment_time);
                    
                    let reminderSms = `Hello ${appt.first_name}, this is a reminder for your Akoben Legal consultation today at ${time12h} (Ref: ${appt.booking_ref}). Please be on time.`;
                    
                    // Virtual Consultation check
                    if (appt.consultation_type === 'Virtual') {
                        reminderSms = `Hello ${appt.first_name}, this is a reminder for your Virtual consultation today at ${time12h} (Ref: ${appt.booking_ref}). Meeting Link: ${appt.zoom_link}. Please be seated on time.`;
                    }
                    
                    await axios.post('https://sms.arkesel.com/api/v2/sms/send', {
                        sender: 'AKOBEN', message: reminderSms, recipients: [formattedPhone]
                    }, { headers: { 'api-key': ARKESEL_API_KEY, 'Content-Type': 'application/json' } })
                    .catch(err => console.log('Reminder SMS error:', err.message));
                }
            }
            console.log(`Sent ${appointments.length} morning reminder(s).`);
        }
    } catch (err) {
        console.error('Error running daily SMS reminder cron:', err.message);
    }
}, {
    scheduled: true,
    timezone: "Africa/Accra"
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Akoben Backend is running securely on port ${PORT}`);
});