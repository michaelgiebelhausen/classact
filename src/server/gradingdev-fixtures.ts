import "server-only";

/**
 * Synthetic submissions for a grading dry run.
 *
 * The pipeline had never been watched end to end against a real model, and a
 * pile of identical lorem ipsum would prove nothing: a ranking is only
 * meaningful if the work genuinely differs in quality. So these span the
 * spread a real class produces — two that are excellent in different ways,
 * a solid middle, some that are competent but generic, and a couple that are
 * thin. `expected` is the author's own ordering hint, used only to eyeball
 * whether the ranking came out sane. Nothing reads it.
 *
 * Markdown on purpose: it is a first-class submission kind, costs a fraction
 * of a PDF in tokens, and gives the shingle phase exact text to work with.
 */

export interface Fixture {
  /** Roughly where this belongs, 1 = best. A sanity check, not a target. */
  expected: number;
  taste: string;
  body: string;
}

const brief = "a one-page memo recommending whether a campus coffee shop should add mobile ordering";

export const DRY_RUN_BRIEF = `# ${brief[0].toUpperCase()}${brief.slice(1)}

Write a one-page memo to the owner of a campus coffee shop recommending
whether to add mobile ordering. Take a position, support it, and be honest
about what would make you wrong.`;

export const DRY_RUN_FIXTURES: Fixture[] = [
  {
    expected: 1,
    taste:
      "A good memo picks a side in the first two sentences and spends the rest earning it. I want a real number somewhere — a cost, a wait time, a margin — not just 'customers want convenience'. The part that matters most to me is whether the writer says what would change their mind; a memo that can't be wrong isn't an argument, it's a brochure.",
    body: `# Recommendation: yes, but start with pickup-only

**Recommendation.** Add mobile ordering for pickup before 10am, and only
that, for one semester.

**Why.** Our line is 14 minutes at its worst (9:10–9:40, between class
blocks) and 3 minutes the rest of the day. That single spike is where we
lose customers: I counted 22 walk-aways in four mornings, roughly $95/day in
lost drinks. Mobile pickup moves that queue off the floor without adding
staff.

**Cost.** Square's mobile ordering runs $0 monthly plus the 2.6% we already
pay on card transactions, so the real cost is a $400 tablet and about six
hours of staff training. Payback at even half the recovered walk-aways is
under two weeks.

**Why not the full build.** Delivery and in-app payment would need a second
person on bar during the spike — that's $180/day in labor against $95/day in
recovered revenue. The economics only work for pickup.

**What would make me wrong.** If the walk-aways are mostly people who would
have ordered drip coffee (our lowest margin), the recovered revenue is closer
to $40/day and the tablet takes two months to pay back. I'd want a week of
till data broken out by drink type before committing. I'd also be wrong if
mobile orders cannibalize the 3-minute periods — if regulars start ordering
ahead at 2pm, we've added complexity to a queue that wasn't broken.`,
  },
  {
    expected: 2,
    taste:
      "Good writing here respects the reader's time and their intelligence. Short memo, clear recommendation, and no padding. I care a lot about whether the writer has actually thought about the people involved — the baristas, not just the customers. Most memos about technology forget that someone has to operate it.",
    body: `# Mobile ordering: not yet

**Recommendation.** Don't add mobile ordering this year. Fix the espresso
machine bottleneck first.

**The real constraint.** Mobile ordering doesn't make drinks faster; it
makes orders arrive faster. Our bottleneck is one espresso machine with a
90-second cycle. At the 9:15 rush we're already at capacity — orders queue
whether they arrive from a phone or a person. Adding mobile ordering to a
saturated bar produces the worst outcome: customers who were promised a
pickup time we can't hit.

**What baristas told me.** Both morning staff independently raised the same
worry: tickets arriving during a rush with no way to pace them. At the campus
location that added mobile ordering last year, staff describe "ticket
panic" — and their Google rating dropped from 4.6 to 4.1, with the reviews
citing wrong and late orders.

**What to do instead.** A second grinder ($1,200) cuts the cycle to about 60
seconds and costs less than a year of the mobile platform plus the tablet.
Revisit mobile ordering once the bar can absorb a burst.

**What would change my mind.** If the queue is mostly drip and pastry —
orders that never touch the espresso machine — then mobile ordering routes
around the bottleneck rather than feeding it. I'd want a morning of ticket
data split by drink type. Also, if the platform allows capping orders per
15-minute window, the ticket-panic objection mostly disappears.`,
  },
  {
    expected: 3,
    taste:
      "I want a memo that's actually decided something. Evidence beats adjectives. If you're going to recommend spending money, say how much and what you get back.",
    body: `# Adding mobile ordering to the campus coffee shop

**Recommendation:** Yes, add mobile ordering.

**Reasoning.** Students are busy between classes and the line is often long
in the morning. Mobile ordering lets them order ahead and pick up, which
saves them time and lets us serve more people during the rush.

**Costs.** The platform costs about $50 a month plus transaction fees, and we
would need a tablet (around $400) and some staff training. Compared to the
revenue from serving more customers during the busy period, this seems
reasonable.

**Benefits.** Shorter lines, happier customers, and better data about what
people order and when. Competitors near campus already offer it, so we're
behind.

**Risks.** Staff will need to adjust to a new workflow, and there may be some
confusion at first about where mobile orders are picked up. A clearly marked
pickup shelf would help.

**Conclusion.** The benefits outweigh the costs. I recommend a trial run
during one semester and reviewing the sales data afterward to decide whether
to keep it.`,
  },
  {
    expected: 4,
    taste:
      "Good work is clear and organized. It should have a beginning, middle, and end, use evidence, and be free of errors. It should also be interesting to read.",
    body: `# Memo: Mobile Ordering

**To:** Owner
**Re:** Should we add mobile ordering?

Mobile ordering has become very popular in the food service industry.
Starbucks reports that a significant portion of their orders now come through
their app. Customers increasingly expect the convenience of ordering ahead.

For a campus coffee shop, the student demographic is especially likely to
adopt mobile ordering, since students are comfortable with technology and
often have tight schedules between classes.

There are costs to consider. Platforms charge monthly fees and transaction
percentages. Staff will need training. There may also be an adjustment period
where orders are confused or delayed.

However, the potential benefits are significant: reduced wait times, higher
throughput during peak hours, increased customer satisfaction, and valuable
data about ordering patterns.

In conclusion, mobile ordering is likely a good investment for a campus
coffee shop, though the owner should carefully evaluate the specific costs
and choose a platform that fits the shop's needs and budget.`,
  },
  {
    expected: 5,
    taste:
      "It should answer the question and be well written. Good grammar and structure matter. Use examples where possible.",
    body: `# Should the coffee shop add mobile ordering?

Mobile ordering is a technology that allows customers to place orders through
a smartphone application before arriving at a store. It has been widely
adopted in the quick-service restaurant industry.

**Advantages:**
- Convenience for customers
- Reduced wait times
- Increased order accuracy
- Data collection about customer preferences
- Competitive parity with other coffee shops

**Disadvantages:**
- Monthly platform costs
- Transaction fees
- Staff training requirements
- Potential technical issues
- Possible congestion at pickup area

**Analysis.** The campus location is relevant because students are
technologically comfortable and frequently pressed for time between classes.
This suggests adoption would be relatively high compared to other locations.

**Recommendation.** The coffee shop should consider adding mobile ordering,
provided the costs are manageable. A trial period would allow the owner to
evaluate whether the benefits materialize before making a long-term
commitment.`,
  },
  {
    expected: 6,
    taste:
      "A good assignment is complete, on topic, and follows the instructions. It should be professional in tone.",
    body: `# Mobile Ordering Recommendation

In today's fast-paced world, technology plays an increasingly important role
in the food and beverage industry. Mobile ordering is one such technology
that has transformed how customers interact with coffee shops.

There are many factors to consider when deciding whether to implement mobile
ordering. On one hand, it offers convenience and efficiency. On the other
hand, it requires investment and changes to existing operations.

Customers today value convenience above almost everything else. A campus
coffee shop serves students who are often in a hurry. Mobile ordering could
serve this need effectively.

At the same time, the owner must consider the financial implications. Any new
technology represents an investment, and the return on that investment is not
always guaranteed.

Overall, mobile ordering represents an opportunity for the campus coffee shop
to modernize its operations and better serve its customer base. The decision
ultimately depends on the owner's assessment of the costs and benefits in the
specific context of this business.`,
  },
  {
    expected: 7,
    taste:
      "Good work follows the assignment guidelines, is well organized, uses appropriate language, and demonstrates understanding of the topic.",
    body: `# Coffee Shop Mobile Ordering Memo

Mobile ordering allows customers to order and pay ahead using their phones.
Many major chains have adopted this technology in recent years.

The benefits include convenience, speed, and modernization. The costs include
fees, equipment, and training. The campus setting means many customers are
students who use smartphones frequently.

A trial period would be one way to test whether mobile ordering works for
this business. During the trial, the owner could collect data on usage and
customer feedback.

In summary, mobile ordering has both advantages and disadvantages that should
be weighed carefully before a decision is made. Both options have merit
depending on the priorities of the business owner.`,
  },
  {
    expected: 8,
    taste:
      "The work should be correct and complete, with good writing and no mistakes.",
    body: `# Mobile ordering

Mobile ordering is when customers use an app to order coffee before they get
to the store. This is popular now.

Pros: it is faster and more convenient. Customers like it. It is modern.

Cons: it costs money. Staff need training. Technology can break.

For a campus coffee shop, students would probably use it because students use
their phones a lot and are usually in a hurry between classes.

I think the coffee shop should add mobile ordering because the benefits are
greater than the costs, and because other coffee shops already have it.`,
  },
  {
    expected: 9,
    taste: "It should be done well and turned in on time.",
    body: `# Memo

Mobile ordering is a good idea for the coffee shop. Customers want
convenience and mobile ordering provides convenience. Many businesses use
mobile ordering today.

The costs are the app and the training but these are worth it because sales
will increase.

In conclusion the coffee shop should get mobile ordering because it will help
the business grow and customers will be happy.`,
  },
  {
    expected: 10,
    taste: "Good work is good.",
    body: `# Mobile Ordering

I think the coffee shop should add mobile ordering. It would be convenient
for students. Technology is important these days and businesses need to keep
up with the times. Mobile ordering is something a lot of places have now.

Overall it seems like a good idea.`,
  },
];
