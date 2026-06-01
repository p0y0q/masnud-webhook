const axios = require('axios');

module.exports = async (req, res) => {
    // 1. التحقق من الـ Webhook (Verification Request)
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode && token) {
            if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
                console.log('Webhook Verified Successfully!');
                return res.status(200).send(challenge);
            } else {
                return res.status(403).send('Verification token mismatch');
            }
        }
        return res.status(400).send('Missing parameters');
    }

    // 2. استقبال الرسائل ومعالجتها (POST Request)
    if (req.method === 'POST') {
        const body = req.body;

        // التأكد من أن الحدث قادم من صفحة إنستغرام
        if (body.object === 'instagram') {
            
            // قراءة الأحداث القادمة
            for (const entry of body.entry) {
                // تفرع الرسائل (messaging)
                if (entry.messaging) {
                    for (const messagingEvent of entry.messaging) {
                        const senderId = messagingEvent.sender.id; // معرف المستخدم المرسل

                        // التأكد من وجود نص في الرسالة وتجنب رسائل البوت لنفسه
                        if (messagingEvent.message && messagingEvent.message.text) {
                            const userMessage = messagingEvent.message.text;
                            
                            // تجنب الرد التلقائي على الرسائل المرسلة من الصفحة نفسها (Echoes)
                            if (messagingEvent.message.is_echo) {
                                continue;
                            }

                            console.log(`Received message from ${senderId}: ${userMessage}`);

                            // معالجة الرسالة وإرسالها إلى OpenRouter ثم إعادة الرد
                            await handleInstagramMessage(senderId, userMessage);
                        }
                    }
                }
            }
            return res.status(200).send('EVENT_RECEIVED');
        } else {
            return res.status(404).send('Not an instagram event');
        }
    }

    // أي نوع طلب آخر غير مدعوم
    return res.status(405).send('Method Not Allowed');
};

// دالة التعامل مع OpenRouter وإرسال الرد لإنستغرام
async function handleInstagramMessage(senderId, userMessage) {
    try {
        // أ) إرسال الرسالة إلى OpenRouter للحصول على رد ذكي
        // يمكنك تغيير الموديل هنا (مثلاً لـ meta-llama/llama-3-70b-instruct أو gpt-3.5-turbo)
        const openRouterResponse = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: 'nvidia/nemotron-3-super-120b-a12b:free', 
                messages: [
                    { role: 'system', content: 'أنت مساعد ذكي مخصص لخدمة عملاء منصة Masnud.iq. أجب باختصار وذكاء وبلهجة ودية تناسب العراقيين.' },
                    { role: 'user', content: userMessage }
                ]
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://masnud.iq', // اختياري لـ OpenRouter ترتيب الترتيب
                    'X-Title': 'Masnud Automation'
                }
            }
        );

        const botReply = openRouterResponse.data.choices[0].message.content;

        // ب) إرسال الرد الناتج إلى إنستغرام Graph API
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages`,
            {
                recipient: { id: senderId },
                message: { text: botReply }
            },
            {
                params: { access_token: process.env.PAGE_ACCESS_TOKEN }
            }
        );

        console.log(`Replied to ${senderId}: ${botReply}`);

    } catch (error) {
        console.error('Error in handling message:', error.response ? error.response.data : error.message);
    }
}