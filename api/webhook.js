const axios = require('axios');

module.exports = async (req, res) => {
    // 1. التحقق من الـ Webhook (GET Request)
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

    // 2. استقبال الأحداث والاختبارات (POST Request)
    if (req.method === 'POST') {
        const body = req.body;

        // طباعة الجسم القادم فوراً في الـ Logs لرؤية أي اختبار مهما كان شكله
        console.log('🔔 Incoming Webhook Event Data:', JSON.stringify(body, null, 2));

        // أ) حالة الاختبار المباشر من لوحة تحكم فيسبوك (الذي أرسلته أنت للتو)
        if (body.sample && body.sample.value) {
            const sampleData = body.sample.value;
            if (sampleData.message && sampleData.message.text) {
                const senderId = sampleData.sender.id;
                const userMessage = sampleData.message.text;
                
                console.log(`[TEST EVENT] Message from ${senderId}: ${userMessage}`);
                await handleInstagramMessage(senderId, `تم استلام فحصك الاختباري بنجاح! رسالتك كانت: ${userMessage}`);
                return res.status(200).send('TEST_EVENT_RECEIVED');
            }
        }

        // ب) حالة الرسائل الحقيقية القادمة من تطبيق إنستغرام
        if (body.object === 'instagram' && body.entry) {
            for (const entry of body.entry) {
                if (entry.messaging) {
                    for (const messagingEvent of entry.messaging) {
                        const senderId = messagingEvent.sender.id;

                        if (messagingEvent.message && messagingEvent.message.text) {
                            // تجنب الرد على الأصداء (الرسائل المرسلة من البوت نفسه)
                            if (messagingEvent.message.is_echo) continue;

                            const userMessage = messagingEvent.message.text;
                            console.log(`[LIVE EVENT] Message from ${senderId}: ${userMessage}`);
                            
                            // معالجة الرسالة وإرسالها لـ OpenRouter
                            await handleInstagramMessage(senderId, userMessage);
                        }
                    }
                }
            }
            return res.status(200).send('EVENT_RECEIVED');
        }

        // إذا وصل طلب غريب لم نطابقه
        return res.status(200).send('Event received but not matched');
    }

    return res.status(405).send('Method Not Allowed');
};

// دالة إرسال الردود
async function handleInstagramMessage(senderId, userMessage) {
    try {
        let botReply = "";

        // إذا كانت الرسالة فحصاً اختبارياً، نرد فوراً بدون استهلاك رصيد OpenRouter
        if (userMessage.includes("تم استلام فحصك الاختباري")) {
            botReply = userMessage;
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
            `https://graph.facebook.com/v25.0/me/messages`, // تم تحديث الإصدار لـ v25.0 بناءً على فحصك
            {
                recipient: { id: senderId },
                message: { text: botReply }
            },
            {
                params: { access_token: process.env.PAGE_ACCESS_TOKEN }
            }
        );

        console.log(`✅ Replied successfully to ${senderId}`);

    } catch (error) {
        console.error('❌ Error in handling message:', error.response ? error.response.data : error.message);
    }
}