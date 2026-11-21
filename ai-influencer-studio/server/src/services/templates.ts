import type { Language, ScriptSectionKey, ScriptSections, Tone } from '../../../shared/types.js';

/**
 * DEMO template writer. Used only when no LLM provider is configured, so the
 * workflow can be explored offline. Everything produced here is stored with
 * provider = "template-demo" and isDemo = true, and the UI labels it as such.
 * It does not understand the topic – it only slots the topic into fixed lines.
 */

interface Vars {
  name: string;
  topic: string;
  audience: string;
  cta: string;
  tone: Tone;
}

type Bank = Record<ScriptSectionKey, ((v: Vars) => string)[]>;

const en: Bank = {
  hook: [
    (v) => `Wait — before you scroll, let me tell you something about ${v.topic} that nobody talks about!`,
    (v) => `Okay, real talk: ${v.topic} is way simpler than you think.`,
    (v) => `Stop! If you care about ${v.topic}, you need the next 30 seconds.`,
  ],
  intro: [
    (v) => `Hey everyone, it's ${v.name}! Today we're talking about ${v.topic}, especially for ${v.audience}.`,
    (v) => `Hi friends, ${v.name} here. So many of you asked me about ${v.topic}, so let's break it down.`,
  ],
  main: [
    (v) =>
      `First thing — don't overthink ${v.topic}. Start small, honestly that's what worked for me. ` +
      `Second, be consistent. Even ten minutes a day makes a real difference. ` +
      `And third, learn from people who are already doing it — you'll save so much time.`,
    (v) =>
      `So here's the thing. Most people get ${v.topic} wrong because they try to do everything at once. ` +
      `Pick one thing, try it this week, and see how it feels. ` +
      `Trust me, small steps add up faster than you'd expect.`,
  ],
  engagement: [
    (v) => `Now tell me — what's your biggest question about ${v.topic}? Drop it in the comments!`,
    () => `Have you tried this before? Comment "yes" or "no" — I read every single one.`,
  ],
  cta: [
    (v) => `${v.cta || 'Follow for more tips like this'}, and save this reel so you don't forget!`,
    (v) => `If this helped, ${v.cta ? v.cta.toLowerCase() : 'hit follow'} — see you in the next one!`,
  ],
};

const hi: Bank = {
  hook: [
    (v) => `रुको! स्क्रॉल करने से पहले ${v.topic} के बारे में ये बात ज़रूर सुनो!`,
    (v) => `सच बताऊँ? ${v.topic} उतना मुश्किल नहीं है जितना आप सोचते हो।`,
    (v) => `क्या आपको पता है कि ${v.topic} आपकी ज़िंदगी कैसे बदल सकता है?`,
  ],
  intro: [
    (v) => `हाय दोस्तों, मैं हूँ ${v.name}! आज बात करेंगे ${v.topic} की — खासकर ${v.audience} के लिए।`,
    (v) => `नमस्ते दोस्तों, ${v.name} यहाँ। आप में से बहुत लोगों ने ${v.topic} के बारे में पूछा था, तो चलो समझते हैं।`,
  ],
  main: [
    (v) =>
      `पहली बात — ${v.topic} को लेकर ज़्यादा मत सोचो, छोटे से शुरुआत करो। ` +
      `दूसरी बात, रोज़ थोड़ा-थोड़ा करो, सिर्फ़ दस मिनट भी काफ़ी हैं। ` +
      `और तीसरी बात, जो लोग पहले से ये कर रहे हैं, उनसे सीखो — बहुत टाइम बचेगा।`,
    (v) =>
      `देखो, ज़्यादातर लोग ${v.topic} में गलती इसलिए करते हैं क्योंकि सब कुछ एक साथ करना चाहते हैं। ` +
      `एक चीज़ चुनो, इस हफ़्ते ट्राई करो और देखो कैसा लगता है। ` +
      `यकीन मानो, छोटे-छोटे स्टेप्स बहुत जल्दी बड़ा फ़र्क लाते हैं।`,
  ],
  engagement: [
    (v) => `अब आप बताओ — ${v.topic} को लेकर आपका सबसे बड़ा सवाल क्या है? कमेंट में लिखो!`,
    () => `क्या आपने ये पहले ट्राई किया है? कमेंट में "हाँ" या "ना" लिखो — मैं हर कमेंट पढ़ती हूँ।`,
  ],
  cta: [
    (v) => `${v.cta || 'ऐसे ही टिप्स के लिए फ़ॉलो करो'}, और इस रील को सेव कर लो ताकि भूलो नहीं!`,
    (v) => `अगर ये काम का लगा तो ${v.cta || 'फ़ॉलो ज़रूर करना'} — मिलते हैं अगली रील में!`,
  ],
};

const mr: Bank = {
  hook: [
    (v) => `थांबा! स्क्रोल करण्याआधी ${v.topic} बद्दल ही गोष्ट नक्की ऐका!`,
    (v) => `खरं सांगू? ${v.topic} तुम्हाला वाटतं तितकं अवघड नाहीये.`,
    (v) => `तुम्हाला माहिती आहे का, ${v.topic} तुमचं आयुष्य कसं बदलू शकतं?`,
  ],
  intro: [
    (v) => `हाय मित्रांनो, मी ${v.name}! आज आपण बोलूया ${v.topic} बद्दल — खास ${v.audience} साठी.`,
    (v) => `नमस्कार मित्रांनो, ${v.name} इथे. तुमच्यापैकी खूप जणांनी ${v.topic} बद्दल विचारलं होतं, चला समजून घेऊया.`,
  ],
  main: [
    (v) =>
      `पहिली गोष्ट — ${v.topic} बद्दल जास्त विचार करू नका, छोट्या गोष्टीपासून सुरुवात करा. ` +
      `दुसरी गोष्ट, रोज थोडं थोडं करा, फक्त दहा मिनिटं सुद्धा पुरेशी आहेत. ` +
      `आणि तिसरी गोष्ट, जे आधीपासून हे करतायत त्यांच्याकडून शिका — खूप वेळ वाचेल.`,
    (v) =>
      `बघा, बहुतेक लोक ${v.topic} मध्ये चूक करतात कारण त्यांना सगळं एकदम करायचं असतं. ` +
      `एक गोष्ट निवडा, या आठवड्यात करून बघा आणि कसं वाटतं ते पहा. ` +
      `विश्वास ठेवा, छोटी छोटी पावलं खूप लवकर मोठा फरक करतात.`,
  ],
  engagement: [
    (v) => `आता तुम्ही सांगा — ${v.topic} बद्दल तुमचा सगळ्यात मोठा प्रश्न कोणता? कमेंटमध्ये लिहा!`,
    () => `तुम्ही हे आधी करून पाहिलंय का? कमेंटमध्ये "हो" किंवा "नाही" लिहा — मी प्रत्येक कमेंट वाचते.`,
  ],
  cta: [
    (v) => `${v.cta || 'अशाच टिप्ससाठी फॉलो करा'}, आणि ही रील सेव्ह करा म्हणजे विसरणार नाही!`,
    (v) => `उपयोगी वाटलं तर ${v.cta || 'नक्की फॉलो करा'} — भेटूया पुढच्या रीलमध्ये!`,
  ],
};

const BANKS: Record<Language, Bank> = { en, hi, mr };

const pickOne = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export function templateScript(language: Language, v: Vars): ScriptSections {
  const bank = BANKS[language];
  return {
    hook: pickOne(bank.hook)(v),
    intro: pickOne(bank.intro)(v),
    main: pickOne(bank.main)(v),
    engagement: pickOne(bank.engagement)(v),
    cta: pickOne(bank.cta)(v),
  };
}

export function templateSection(language: Language, key: ScriptSectionKey, v: Vars, current: string): string {
  const options = BANKS[language][key].map((f) => f(v)).filter((t) => t !== current);
  return options.length ? pickOne(options) : BANKS[language][key][0](v);
}

export function templateTitle(language: Language, topic: string): string {
  if (language === 'hi') return `${topic} — आसान भाषा में`;
  if (language === 'mr') return `${topic} — सोप्या भाषेत`;
  return `${topic} — explained simply`;
}
