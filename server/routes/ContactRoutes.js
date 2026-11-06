const express = require('express');

const MAX_FIRST_NAME_LENGTH = 50;
const MAX_LAST_NAME_LENGTH = 50;
const MAX_EMAIL_LENGTH = 254;
const MAX_MESSAGE_LENGTH = 2000;

function normalizeFirstName(firstname) {
    return typeof firstname === "string" ? firstname.trim().replace(/\s+/g, " ") : "";
}

function normalizeLastName(lastname) {
    return typeof lastname === "string" ? lastname.trim().replace(/\s+/g, " ") : "";
}

function normalizeEmail(email) {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function normalizeMessage(message) {
    return typeof message === "string" ? message.trim() : "";
}

function isValidFirstName(firstname) {
    if (firstname.length < 0 || firstname.length > MAX_FIRST_NAME_LENGTH) {
        return false;
    }
    return /^[A-Za-z][A-Za-z\s'-]{2,49}$/.test(firstname);
}

function isValidLastName(lastname) {
    if (lastname.length < 0 || lastname.length > MAX_LAST_NAME_LENGTH) {
        return false;
    }
    return /^[A-Za-z][A-Za-z\s'-]{2,49}$/.test(lastname);
}

function isValidEmail(email) {
    if (email.length < 0 || email.length > MAX_EMAIL_LENGTH) {
        return false;
    }
    return /^[^\s@]+@[^\s@]+\.(com|gov|edu|net|org)$/i.test(email);
}

function isValidMessage(message) {
    return message.length > 0 && message.length <= MAX_MESSAGE_LENGTH;
}

function createContactRouter(transporter, supportRecipient, fromAddress) {
    const router = express.Router();
    router.post('/', async (req, res) => {
        if (!transporter || !supportRecipient || !fromAddress) {
            return res.status(503).json({
                 message: "Your support request could not be submitted. Please try again." });
        }
        const firstname = normalizeFirstName(req.body.firstname);
        const lastname = normalizeLastName(req.body.lastname);
        const email = normalizeEmail(req.body.email);
        const message = normalizeMessage(req.body.message);

        if (!isValidFirstName(firstname) || !isValidLastName(lastname) || !isValidEmail(email) || !isValidMessage(message)) {
            return res.status(400).json({ message: "One or more fields exceed the allowed length." });
        }

        const mailOptions = {
            from: fromAddress,
            to: supportRecipient,
            subject: `DockVision Support Request from ${firstname} ${lastname}`,
            text: [
                "A new DockVision support request was submitted.",
                "",
                `Name: ${firstname} ${lastname}`,
                `Email: ${email}`,
                "",
                `Message: ${message}`
            ].join("\n")
        };

        try {
            await transporter.sendMail(mailOptions);
            return res.status(200).json({ message: "Your support request was submitted successfully." });
        } catch (error) {
            console.error("Error sending email:", error);
            return res.status(500).json({ message: "Your support request could not be submitted. Please try again." });
        }
    });

    return router;
}

module.exports = { createContactRouter };