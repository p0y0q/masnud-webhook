const axios = require('axios');

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// تشخيص المتغيرات عند أول تشغيل
console.log('🔧 ENV Check → TOKEN:', PAGE_ACCESS_TOKEN ? `موجود (${PAGE_ACCESS_TOKEN.length} حرف)` : '🚨 مفقود!');
console.log('🔧 ENV Check → OPENROUTER:', OPENROUTER_API_KEY ? 'موجود ✅' : '🚨 مفقود!');

module.exports = async (req, res) => {

    // =========================================================
    // GET: التحقق من الـ Webhook مع Meta
    // =========================================================
    if (req.method === 'GET') {
        const mode      = req.query['hub.mode'];
        const token     = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('✅ Webhook Verified!');
            return res.status(200).send(challenge);
        }
        return res.status(403).send('Forbidden');
    }

    // =========================================================
    // POST: استقبال الأحداث من Meta
    // ⚠️ مهم جداً: في Vercel لازم نعالج الكل قبل نرسل الـ 200
    // لأن Vercel يوقف الـ function بعد res.send() مباشرة
    // =========================================================
    if (req.method === 'POST') {
        const body = req.body;
        console.log('🔔 Incoming Event:', JSON.stringify(body, null, 2));

        if (body.object === 'instagram' && body.entry) {
            const promises = [];

            for (const entry of body.entry) {
                const pageId = entry.id;

                if (entry.messaging) {
                    for (const event of entry.messaging) {
                        promises.push(processMessagingEvent(pageId, event));
                    }
                }

                if (entry.changes) {
                    for (const change of entry.changes) {
                        if (change.field === 'messages' && change.value?.message?.text) {
                            const { sender, message } = change.value;
                            promises.push(handleText(pageId, sender.id, message.text));
                        }
                    }
                }
            }

            // ننتظر كل العمليات تخلص قبل نرسل الـ 200
            await Promise.allSettled(promises);
        }

        // نرسل الـ 200 بس بعد ما كل شي خلص
        return res.status(200).send('EVENT_RECEIVED');
    }

    return res.status(405).send('Method Not Allowed');
};

// =========================================================
// معالجة الأحداث
// =========================================================
async function processMessagingEvent(pageId, event) {
    const senderId = event.sender?.id;
    if (!senderId) return;

    if (event.message?.is_echo) {
        console.log('⏩ Echo ignored.');
        return;
    }

    // رسالة نصية
    if (event.message?.text) {
        return handleText(pageId, senderId, event.message.text);
    }

    // مرفق (صورة / فيديو / صوت)
    if (event.message?.attachments) {
        const type = event.message.attachments[0].type;
        console.log(`📎 Attachment [${type}] from ${senderId}`);
        const replies = {
            image: 'وصلت الصورة! 📸 هل تريد مساعدة بخصوصها؟',
            video: 'وصل الفيديو! 🎥 كيف أقدر أساعدك؟',
            audio: 'وصلت الرسالة الصوتية! 🎙️ اكتب سؤالك وأجاوبك فوراً.',
            file:  'وصل الملف! 📄 كيف أقدر أساعدك؟'
        };
        return sendReply(pageId, senderId, replies[type] || 'شكراً! 😊 كيف أقدر أساعدك؟');
    }

    // بصمة / Reaction
    if (event.reaction) {
        const emoji = event.reaction.emoji || '❤️';
        console.log(`${emoji} Reaction from ${senderId}`);
        const reactionMap = {
            '❤️': 'شكراً! ❤️ يسعدنا خدمتك دائماً.',
            '😂': 'يسعدنا أنك مبسوط! 😄',
            '😮': 'شكراً على تفاعلك! 😊',
            '😢': 'نتمنى تكون بخير! 🌟',
            '😠': 'نأسف على أي إزعاج، راسلنا ونحل المشكلة. 🙏'
        };
        return sendReply(pageId, senderId, reactionMap[emoji] || 'شكراً على تفاعلك! 😊');
    }
}

async function handleText(pageId, senderId, userMessage) {
    console.log(`💬 [TEXT] from ${senderId}: ${userMessage}`);
    const reply = await getAIReply(userMessage);
    return sendReply(pageId, senderId, reply);
}

// =========================================================
// الذكاء الاصطناعي - OpenRouter
// =========================================================
async function getAIReply(userMessage) {
    if (userMessage === 'random_text') {
        return 'أهلاً! النظام يعمل بكفاءة ✅';
    }

    console.log('🤖 Calling OpenRouter...');

    try {
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: 'nex-agi/nex-n2-pro:free',
                messages: [
                    {
                        role: 'system',
                        content: `أنت مساعد ذكي لخدمة عملاء منصة Masnud.iq.
أجب باختصار وبلهجة عراقية ودية ومهنية.
لا تتجاوز 3 جمل في كل رد.
إذا سأل عن الأسعار أو الطلبات وجّهه للموقع masnud.iq`
                    },
                    { role: 'user', content: userMessage }
                ],
                max_tokens: 300,
                temperature: 0.7
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'X-Title': 'Masnud Automation',
                    'HTTP-Referer': 'https://masnud.iq'
                },
                timeout: 20000
            }
        );

        const reply = response.data.choices?.[0]?.message?.content?.trim();
        console.log(`🤖 AI Reply: ${reply}`);
        return reply || 'شكراً لتواصلك! سنرد عليك قريباً. 😊';

    } catch (error) {
        console.error('❌ OpenRouter Error:', JSON.stringify(error.response?.data || error.message));
        return 'شكراً لتواصلك مع Masnud.iq! سيتواصل معك فريقنا قريباً. 😊';
    }
}

// =========================================================
// إرسال الرد عبر Graph API
// =========================================================
async function sendReply(pageId, recipientId, text) {
    if (!PAGE_ACCESS_TOKEN) {
        console.error('🚨 PAGE_ACCESS_TOKEN مفقود!');
        return;
    }

    const safeText = text.length > 1000 ? text.substring(0, 997) + '...' : text;
    console.log(`📤 Sending to ${recipientId} via page ${pageId}: "${safeText.substring(0, 50)}..."`);

    try {
        const response = await axios.post(
            `https://graph.facebook.com/v21.0/${pageId}/messages`,
            {
                recipient: { id: recipientId },
                message: { text: safeText },
                messaging_type: 'RESPONSE'
            },
            {
                params: { access_token: PAGE_ACCESS_TOKEN },
                timeout: 10000
            }
        );

        console.log(`✅ Sent! message_id: ${response.data.message_id}`);

    } catch (error) {
        const err = error.response?.data?.error;
        if (err) {
            console.error(`❌ Graph API [${err.code}]: ${err.message}`);
            if (err.code === 190) console.error('🔑 التوكن منتهي أو غلط → جدد PAGE_ACCESS_TOKEN في Vercel');
            if (err.code === 100) console.error('🆔 معرف المستخدم غير صحيح أو ما راسل الصفحة أولاً');
            if (err.code === 10)  console.error('🔒 صلاحيات ناقصة → تحقق من instagram_manage_messages');
            if (err.code === 200) console.error('🔒 صلاحية مفقودة → تحقق من pages_messaging');
        } else {
            console.error('❌ Network Error:', error.message);
        }
    }
}
