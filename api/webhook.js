const axios = require('axios');

// ✅ تشخيص التوكن عند بدء التشغيل
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!PAGE_ACCESS_TOKEN) console.error('🚨 PAGE_ACCESS_TOKEN غير موجود في Environment Variables!');
if (!VERIFY_TOKEN) console.error('🚨 VERIFY_TOKEN غير موجود في Environment Variables!');
if (!OPENROUTER_API_KEY) console.error('🚨 OPENROUTER_API_KEY غير موجود في Environment Variables!');

module.exports = async (req, res) => {

    // =========================================================
    // GET: التحقق من الـ Webhook مع Meta
    // =========================================================
    if (req.method === 'GET') {
        const mode      = req.query['hub.mode'];
        const token     = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        console.log('🔐 Webhook verification attempt:', { mode, token: token ? '***' : 'MISSING' });

        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('✅ Webhook Verified Successfully!');
            return res.status(200).send(challenge);
        }

        console.error('❌ Verification failed. Token mismatch or wrong mode.');
        return res.status(403).send('Forbidden');
    }

    // =========================================================
    // POST: استقبال الأحداث من Meta
    // =========================================================
    if (req.method === 'POST') {
        // إرجاع 200 فوراً لـ Meta قبل أي معالجة (مطلوب خلال 20 ثانية)
        res.status(200).send('EVENT_RECEIVED');

        const body = req.body;
        console.log('🔔 Incoming Event:', JSON.stringify(body, null, 2));

        if (body.object !== 'instagram' || !body.entry) return;

        for (const entry of body.entry) {
            const pageId = entry.id;

            // --- مسار الرسائل الحقيقية (messaging) ---
            if (entry.messaging) {
                for (const event of entry.messaging) {
                    await processMessagingEvent(pageId, event);
                }
            }

            // --- مسار أحداث التغيير (changes) - اختبارات Meta أو تعليقات ---
            if (entry.changes) {
                for (const change of entry.changes) {
                    if (change.field === 'messages' && change.value?.message?.text) {
                        const { sender, message } = change.value;
                        console.log(`[CHANGE] from ${sender.id}: ${message.text}`);
                        await sendInstagramMessage(pageId, sender.id, message.text);
                    }
                }
            }
        }

        return;
    }

    return res.status(405).send('Method Not Allowed');
};

// =========================================================
// معالجة حدث رسالة واحدة
// =========================================================
async function processMessagingEvent(pageId, event) {
    const senderId = event.sender?.id;
    if (!senderId) return;

    // تجاهل echo (رسائل الصفحة نفسها)
    if (event.message?.is_echo) {
        console.log('⏩ Echo message ignored.');
        return;
    }

    // --- رسالة نصية ---
    if (event.message?.text) {
        const userMessage = event.message.text;
        console.log(`💬 [TEXT] from ${senderId}: ${userMessage}`);

        const reply = await getAIReply(userMessage);
        await sendInstagramMessage(pageId, senderId, reply);
        return;
    }

    // --- مرفق (صورة / فيديو / ملف) ---
    if (event.message?.attachments) {
        const att = event.message.attachments[0];
        console.log(`📎 [ATTACHMENT] type: ${att.type} from ${senderId}`);

        let replyText = '';
        if (att.type === 'image') {
            replyText = await getAIReply(`المستخدم أرسل صورة. كيف يمكنك مساعدته؟`);
        } else if (att.type === 'video') {
            replyText = 'شكراً على الفيديو! 🎥 هل يمكنني مساعدتك بشيء محدد؟';
        } else if (att.type === 'audio') {
            replyText = 'شكراً على الرسالة الصوتية! 🎙️ يمكنك كتابة سؤالك وسأجيبك فوراً.';
        } else {
            replyText = 'شكراً على مراسلتنا! 😊 كيف يمكننا مساعدتك؟';
        }

        await sendInstagramMessage(pageId, senderId, replyText);
        return;
    }

    // --- بصمة / Reaction ---
    if (event.reaction) {
        const emoji = event.reaction.emoji || '❤️';
        console.log(`${emoji} [REACTION] from ${senderId}`);
        const replies = {
            '❤️': 'شكراً جزيلاً! ❤️ يسعدنا خدمتك دائماً.',
            '😂': 'يسعدنا أنك مبسوط! 😄',
            '😮': 'شكراً على تفاعلك! 😊',
            '😢': 'نتمنى أن تكون بخير! 🌟',
            '😠': 'نأسف على أي إزعاج، تواصل معنا لنحل المشكلة. 🙏'
        };
        await sendInstagramMessage(pageId, senderId, replies[emoji] || 'شكراً على تفاعلك! 😊');
        return;
    }

    console.log('⚠️ Unknown event type, ignored:', JSON.stringify(event));
}

// =========================================================
// الذكاء الاصطناعي عبر OpenRouter
// =========================================================
async function getAIReply(userMessage) {
    // رسالة اختبار
    if (userMessage === 'random_text') {
        return 'أهلاً! تم فحص نظام الاستجابة التلقائية بنجاح ✅';
    }

    try {
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: 'nex-agi/nex-n2-pro:free',
                messages: [
                    {
                        role: 'system',
                        content: `أنت مساعد ذكي مخصص لخدمة عملاء منصة Masnud.iq.
أجب باختصار وبلهجة عراقية ودية ومهنية.
لا تتجاوز 3 جمل في كل رد.
إذا سأل عن الأسعار أو الطلبات، وجّهه للتواصل عبر الموقع.`
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
                    'X-Title': 'Masnud Automation'
                },
                timeout: 15000
            }
        );

        const reply = response.data.choices[0]?.message?.content?.trim();
        console.log(`🤖 AI Reply: ${reply}`);
        return reply || 'شكراً لتواصلك! سنرد عليك قريباً. 😊';

    } catch (error) {
        console.error('❌ OpenRouter Error:', error.response?.data || error.message);
        return 'شكراً لتواصلك مع Masnud.iq! سيتواصل معك فريقنا قريباً. 😊';
    }
}

// =========================================================
// إرسال الرد عبر Instagram Graph API
// =========================================================
async function sendInstagramMessage(pageId, recipientId, text) {
    // التحقق من التوكن قبل الإرسال
    if (!PAGE_ACCESS_TOKEN) {
        console.error('🚨 لا يمكن الإرسال: PAGE_ACCESS_TOKEN غير موجود!');
        return;
    }

    // قطع الرسائل الطويلة (حد انستغرام 1000 حرف)
    const safeText = text.length > 1000 ? text.substring(0, 997) + '...' : text;

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

        console.log(`✅ Message sent to ${recipientId}. Message ID: ${response.data.message_id}`);

    } catch (error) {
        const errData = error.response?.data?.error;
        if (errData) {
            console.error(`❌ Graph API Error [Code ${errData.code}]: ${errData.message}`);
            // تشخيص أشهر الأخطاء
            if (errData.code === 190) {
                console.error('🔑 السبب: التوكن منتهي أو غلط. جدد PAGE_ACCESS_TOKEN في Vercel.');
            } else if (errData.code === 100) {
                console.error('🆔 السبب: معرف المستخدم غير صحيح أو لم يبدأ المحادثة.');
            } else if (errData.code === 10) {
                console.error('🔒 السبب: صلاحيات API ناقصة. تحقق من instagram_manage_messages.');
            }
        } else {
            console.error('❌ Network Error:', error.message);
        }
    }
}
