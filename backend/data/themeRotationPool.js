/**
 * 周轮换主题池（与库表 `themes` 写入字段对应）。每周从池中取 3 条，顺序由 `weekThemeCycle` 与周一起算偏移决定。
 */
const POOL = [
  {
    name: "职场面试",
    description: "模拟英文面试，讨论职业规划",
    difficulty_level: "intermediate",
    scene_text:
      "你来到一家知名的跨国科技公司参加面试。会议室灯光明亮，面试官坐在桌子对面，已经读过你的简历，正等待你用英语完成自我介绍并阐述你与岗位的匹配点。",
    roles_json: JSON.stringify([
      { label: "ROLE 1", name: "面试官", desc: "负责评估你的专业能力、逻辑表达与英语流利度。" },
      { label: "ROLE 2", name: "求职者", desc: "有备而来，展示经历并回答对方提问，争取留下好印象。" },
    ]),
    cover_url: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&q=80",
    preview_markdown:
      "## Key vocabulary\n- **initiate** — 发起；开始\n- **candidate** — 候选人\n- **qualification** — 资质\n\n## Useful lines\n- I would like to elaborate on my experience in…\n- Could you tell me more about the team structure?\n",
  },
  {
    name: "雅思口语 Part 2",
    description: "随机抽取题库进行 2 分钟独白练习",
    difficulty_level: "intermediate",
    scene_text:
      "考官给出一张话题卡，你有一分钟准备时间，随后需要连续陈述约两分钟。对方会认真聆听，并在最后追问一两个相关问题。",
    roles_json: JSON.stringify([
      { label: "ROLE 1", name: "考生", desc: "根据话题卡组织独白，注意时态与衔接词。" },
      { label: "ROLE 2", name: "考官", desc: "提示开始/结束，并在 Part 2 后提出简短追问。" },
    ]),
    cover_url: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&q=80",
    preview_markdown:
      "## Part 2 tips\n- Use the **one-minute** prep to jot down **keywords**.\n- Structure: introduction → main points → conclusion.\n\n## Sample stems\n- Describe a place you visited…\n- Talk about an important decision…\n",
  },
  {
    name: "日常闲聊",
    description: "轻松的话题，分享生活趣事",
    difficulty_level: "beginner",
    scene_text:
      "咖啡馆靠窗的座位，你和刚认识的语伴决定用英语随便聊聊近况、旅行或周末计划，氛围轻松自然。",
    roles_json: JSON.stringify([
      { label: "ROLE 1", name: "发起聊天的人", desc: "主动抛话题、接话并维持对话节奏。" },
      { label: "ROLE 2", name: "倾听与回应", desc: "认真回应、追问细节，让对话延续下去。" },
    ]),
    cover_url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80",
    preview_markdown:
      "## Small talk\n- **How's your day going?**\n- **Any plans for the weekend?**\n\n## Light fillers\n- That's interesting!\n- I see what you mean.\n",
  },
  {
    name: "酒店入住与退房",
    description: "前台沟通、房型与账单说明",
    difficulty_level: "beginner",
    scene_text: "你刚抵达海外酒店前台，需要办理入住并确认早餐与退房时间。",
    roles_json: JSON.stringify([
      { label: "ROLE 1", name: "前台", desc: "核对预订、说明房型与酒店政策。" },
      { label: "ROLE 2", name: "住客", desc: "提出需求、确认账单与退房时间。" },
    ]),
    cover_url: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80",
    preview_markdown:
      "## Phrases\n- **reservation** — 预订\n- **check-out** — 退房\n\n## Lines\n- I have a reservation under the name…\n- Could I have a quiet room, please?\n",
  },
  {
    name: "学术小组讨论",
    description: "课堂汇报与同伴反馈",
    difficulty_level: "intermediate",
    scene_text: "小组需要就阅读材料交换观点，并准备向全班总结结论。",
    roles_json: JSON.stringify([
      { label: "ROLE 1", name: "组长", desc: "引导讨论、分配发言时间。" },
      { label: "ROLE 2", name: "组员", desc: "提出论据、回应质疑。" },
    ]),
    cover_url: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=800&q=80",
    preview_markdown:
      "## Academic language\n- **hypothesis** — 假设\n- **evidence** — 证据\n\n## Stems\n- One limitation of this argument is…\n- I would add that…\n",
  },
  {
    name: "餐厅点餐",
    description: "菜单、忌口与结账",
    difficulty_level: "beginner",
    scene_text: "你在国外餐厅点餐，需要说明忌口并询问推荐菜。",
    roles_json: JSON.stringify([
      { label: "ROLE 1", name: "服务员", desc: "介绍菜品、确认订单。" },
      { label: "ROLE 2", name: "顾客", desc: "询问推荐、说明过敏与饮料偏好。" },
    ]),
    cover_url: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80",
    preview_markdown:
      "## Vocabulary\n- **allergy** — 过敏\n- **bill** — 账单\n\n## Useful lines\n- I'm allergic to nuts.\n- Could we have the check, please?\n",
  },
  {
    name: "问路指路",
    description: "地铁、步行路线与地标",
    difficulty_level: "beginner",
    scene_text: "游客在陌生城市向路人询问最近的地铁站与步行方向。",
    roles_json: JSON.stringify([
      { label: "ROLE 1", name: "路人", desc: "指路、说明换乘。" },
      { label: "ROLE 2", name: "游客", desc: "确认方向、致谢。" },
    ]),
    cover_url: "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800&q=80",
    preview_markdown:
      "## Words\n- **intersection** — 路口\n- **platform** — 站台\n\n## Lines\n- How do I get to…?\n- Is it within walking distance?\n",
  },
  {
    name: "客户服务投诉",
    description: "订单问题与解决方案",
    difficulty_level: "intermediate",
    scene_text: "客户因配送延误联系在线客服，希望获得补偿或加急处理。",
    roles_json: JSON.stringify([
      { label: "ROLE 1", name: "客服", desc: "致歉、查单、给出方案。" },
      { label: "ROLE 2", name: "客户", desc: "说明问题、提出合理诉求。" },
    ]),
    cover_url: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800&q=80",
    preview_markdown:
      "## Phrases\n- **refund** — 退款\n- **tracking number** — 物流单号\n\n## Lines\n- My order hasn't arrived yet.\n- I would appreciate a partial refund.\n",
  },
  {
    name: "租房看房",
    description: "租金、押金与设施确认",
    difficulty_level: "intermediate",
    scene_text: "你与中介看房，需要了解租金、押金与家电是否齐全。",
    roles_json: JSON.stringify([
      { label: "ROLE 1", name: "中介", desc: "介绍房源与合同条款。" },
      { label: "ROLE 2", name: "租客", desc: "询问费用、维修与入住时间。" },
    ]),
    cover_url: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=80",
    preview_markdown:
      "## Terms\n- **deposit** — 押金\n- **utilities** — 水电杂费\n\n## Lines\n- Is the rent inclusive of utilities?\n- When would the lease start?\n",
  },
  {
    name: "健身入会咨询",
    description: "会员卡种类与课程预约",
    difficulty_level: "beginner",
    scene_text: "你想办理健身卡，向会籍顾问了解价格与团课安排。",
    roles_json: JSON.stringify([
      { label: "ROLE 1", name: "会籍顾问", desc: "介绍卡种与促销。" },
      { label: "ROLE 2", name: "访客", desc: "询问器械、团课与请假规则。" },
    ]),
    cover_url: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=80",
    preview_markdown:
      "## Words\n- **membership** — 会员\n- **trial** — 体验\n\n## Lines\n- Do you offer a free trial?\n- Can I freeze my membership if I travel?\n",
  },
  {
    name: "商务电话会议",
    description: "议程推进与行动项确认",
    difficulty_level: "advanced",
    scene_text: "跨时区团队电话会，你需要汇报进度并确认下一步负责人。",
    roles_json: JSON.stringify([
      { label: "ROLE 1", name: "主持人", desc: "控制议程、记录行动项。" },
      { label: "ROLE 2", name: "汇报人", desc: "更新进度、提出风险。" },
    ]),
    cover_url: "https://images.unsplash.com/photo-1553877522-43269d4ea984?w=800&q=80",
    preview_markdown:
      "## Phrases\n- **action item** — 行动项\n- **blocker** — 阻碍\n\n## Lines\n- I'll follow up with the vendor by Friday.\n- We are blocked on legal approval.\n",
  },
  {
    name: "旅行机场安检",
    description: "液体、电子产品与登机口",
    difficulty_level: "beginner",
    scene_text: "你在安检口配合检查，并询问登机口变更信息。",
    roles_json: JSON.stringify([
      { label: "ROLE 1", name: "安检人员", desc: "说明规定、指引流程。" },
      { label: "ROLE 2", name: "旅客", desc: "配合检查、询问登机口。" },
    ]),
    cover_url: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=800&q=80",
    preview_markdown:
      "## Words\n- **boarding pass** — 登机牌\n- **liquids** — 液体\n\n## Lines\n- Do I need to remove my laptop?\n- Has the gate changed for flight…?\n",
  },
];

function hashWeekMonday(weekMondayYmd) {
  let h = 0;
  for (let i = 0; i < weekMondayYmd.length; i++) {
    h = (h * 31 + weekMondayYmd.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** @returns {typeof POOL[0][]} 长度为 3 */
function pickThreeForWeek(weekMondayYmd) {
  const base = hashWeekMonday(weekMondayYmd);
  return [0, 1, 2].map((i) => POOL[(base + i) % POOL.length]);
}

module.exports = { POOL, pickThreeForWeek };
