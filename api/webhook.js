const axios = require('axios');

module.exports = async (req, res) => {
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

    if (req.method === 'POST') {
        const body = req.body;

        console.log('🔔 Incoming Webhook Event Data:', JSON.stringify(body, null, 2));

        // معالجة بيانات إنستغرام
        if (body.object === 'instagram' && body.entry) {
            for (const entry of body.entry) {
                
                // 1. معالجة الأحداث القادمة عبر الـ changes (مثل طلب الاختبار الحالي)
                if (entry.changes) {
                    for (const change of entry.changes) {
                        if (change.field === 'messages' && change.value) {
                            const changeValue = change.value;
                            if (changeValue.message && changeValue.message.text) {
                                const senderId = changeValue.sender.id;
                                const userMessage = changeValue.message.text;

                                console.log(`[CHANGE EVENT] Message from ${senderId}: ${userMessage}`);
                                await handleInstagramMessage(senderId, userMessage);
                            }
                        }
                    }
                }

                // 2. معالجة الأحداث القادمة عبر الـ messaging الحقيقية
                if (entry.messaging) {
                    for (const messagingEvent of entry.messaging) {
                        const senderId = messagingEvent.sender.id;

                        if (messagingEvent.message && messagingEvent.message.text) {
                            if (messagingEvent.message.is_echo) continue;

                            const userMessage = messagingEvent.message.text;
                            console.log(`[MESSAGING EVENT] Message from ${senderId}: ${userMessage}`);
                            await handleInstagramMessage(senderId, userMessage);
                        }
                    }
                }
            }
            return res.status(200).send('EVENT_RECEIVED');
        }

        return res.status(200).send('Event received but not processed');
    }

    return res.status(405).send('Method Not Allowed');
};

async function handleInstagramMessage(senderId, userMessage) {
    try {
        let botReply = "";

        // إذا كانت الرسالة عبارة عن نص الاختبار الوهمي من فيسبوك
        if (userMessage === "random_text") {
            botReply = "أهلاً بك! تم فحص نظام الاستجابة التلقائية لمختبر Masnud.iq بنجاح، السيرفر يعمل بكفاءة ومستعد للذكاء الاصطناعي.";
            console.log("🛠️ Test message detected, sending standard test response.");
        } else {
            // استدعاء OpenRouter للرسائل الحقيقية
            const openRouterResponse = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                {
                    model: 'nvidia/nemotron-3-super-120b-a12b:free', 
                    messages: [
                        { role: 'system', content: 'أنت مساعد ذكي مخصص لخدمة عملاء منصة Masnud.iq. أجب باختصار وبلهجة عراقية ودية.' },
                        { role: 'user', content: userMessage }
                    ]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        'Content-Type': 'application/json',
                        'X-Title': 'Masnud Automation'
                    }
                }
            );
            botReply = openRouterResponse.data.choices[0].message.content;
        }

        // إرسال الرد النهائي إلى إنستغرام Graph API
        await axios.post(
            `https://graph.facebook.com/v25.0/me/messages`,
            {
                recipient: { id: senderId },
                message: { text: botReply }
            },
            {
                params: { access_token: process.env.PAGE_ACCESS_TOKEN }
            }
        );

        console.log(`✅ Sent reply to ${senderId}: ${botReply}`);

    } catch (error) {
        console.error('❌ Error sending message:', error.response ? error.response.data : error.message);
    }
}