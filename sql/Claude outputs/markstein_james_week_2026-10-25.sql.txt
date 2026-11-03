-- James Mendoza (CMC) -> Markstein check-ins, week 10/25-11/1/2026 (2026-11-02, per Chad).
-- From James's Monday email "Full Circle Weekly Recap 10.25-11.1" (11/2): the
-- "Full Circle WR 10.25-11.1.docx" visits + "Full Circle CC's 10.25-11.1.xlsx"
-- commitments. Same rules as sql/markstein_james_history.sql:
--   * every store matched to its account by Claude (street number + city, then
--     name checked by hand); same store + same day counted once
--   * 2 stores not in the account list added as Markstein prospects ("CMC-" id)
--   * every account James visited set to distributor Markstein
--   * visits = rep "James", outcome "Visited", On/Off Premise from the account
--   * commitments = a separate "Committed" check-in with what he committed to
--   * dropped: the Markstein warehouse POS pickup (10/29), duplicate Whole Foods visit (10/26)
-- Safe to run more than once: first removes James's recap check-ins dated 10/25-11/1.
-- Run in Supabase's SQL Editor.

begin;

insert into public.sales_accounts (outlet_id, name, address, city, state, distributor, premise, report_note) values
('CMC-FD2427A4','Doppio Zero','1522 N Main St','Walnut Creek','CA','Markstein','On','Added from James''s (CMC) visits — not in the account list yet.'),
('CMC-CB3B695E','THE LODGE','3758 Piedmont Ave','Oakland','CA','Markstein','On','Added from James''s (CMC) visits — not in the account list yet.')
on conflict (outlet_id) do nothing;

update public.sales_accounts set distributor = 'Markstein', updated_at = now()
where outlet_id in ('1948540','2013742','2211938','2213498','2213771','2213870','2215286','2907373','2918238','2934919','3119964','3129046','3129050','3196529','3235289','3293751','3399674','3627659','3658338','3778878','3980916','4033539','4049043','4117446','4164526','4271003','4298874','4386416','4421381','4469502','4664706','4704895','4771129','4800114','4873739','4905718','4914576','532385','532898','534248','534483','535653','538183','96287','96298','CMC-CB3B695E','CMC-FD2427A4')
  and distributor is distinct from 'Markstein';

delete from public.sales_account_checkins
where source = 'CMC: James weekly recap'
  and checkin_date between date '2026-10-25' and date '2026-11-01';

insert into public.sales_account_checkins (outlet_id, checkin_date, rep, activity, outcome, notes, brands, contact, source)
select v.outlet_id, v.d::date, 'James',
       case a.premise when 'On' then 'On Premise Visit' when 'Off' then 'Off Premise Visit' else 'Field Visit' end,
       'Visited', v.notes, null, v.contact, 'CMC: James weekly recap'
from (values
('4117446','2026-10-26','Customer is permanently closing his store location.','Baldeep'),
('4800114','2026-10-26','Normal point of contact is not in. Worked backstock, replenished the shelf in the mini mart cooler and added POS. At this time reinvestment seems likely because there is no more backstock. I will return later in the week to gain approval for reinvestment from the buyer','Richard'),
('3196529','2026-10-26','Customer states that they are fairly set with their tap offerings and that they do not currently have the fridge space to accommodate another new product. Customer denied samples and states that they most likely will not add any new items until after football season ends','Jake'),
('2013742','2026-10-26','Customer states that they do offer a decent selection of pre packed items and that she isnt sure if they are adding new items at this time because the account is looking to move locations. The bar manager has the final say and will be in later this week.','Lara'),
('CMC-FD2427A4','2026-10-26','This location currently does not have an account with our distributor partner. The manager however states that they are looking to expand/amend their current selection and that our pre pack and draft options could be a great fit for them. This restaurant is part of a group so ownership has the final say. Customer will sample the product and review sales materials to determine whether or not we make sense for their account and take it from there. I mentioned that if they wanted to start with a smaller investment I would be more than happy to hand deliver the product so that the minimum order requirement does not prevent them from investing in us.','Veronica'),
('2934919','2026-10-26','Customer isnt sure whether they received the product or not since my previous visit. Reaching out to the assigned rep to see if it landed. We are currently out at the warehouse so this will most likely be something i will revisit once we are in stock','Jonnie'),
('2215286','2026-10-26','Customer is focused on items in the current schematic','Jeya'),
('3778878','2026-10-26','Customer only has 3 units of the big daddy 19.2s remaining on the shelf. All other SKUs are full and on the shelf. Added statics to the doors to help increase visibility. Account will reinvest in the 19.2s as soon as they are available','Sunny'),
('4421381','2026-10-26','Introduced the brand and our portfolio options. The buyer wont be in until later this week but he will pass along my card and maybe we can plan a meeting to swing by and officially introduce everything. Bartender does state that they have a lot of products already so he isnt sure how likely it would be for the bar manager to add anything else at this time.','Jimmy'),
('4914576','2026-10-26','Main point of contact took the day off today. I could not locate the accounts prior commitment and the bartender did not recognize the product when i showed her the sell sheet. I will text or stop by to speak with the owner later in the week. I know we are out at the warehouse so maybe it is just an inventory issue','Jess'),
('538183','2026-10-27','Customer is very familiar with the brand. Account has inventory this weekend and asks that i revisit with him next week to see if we can find space in their set','AL'),
('4049043','2026-10-27','Account has not gotten around to sampling everything I left on my previous visit. Customer is familiar with big daddy and believes that this could be a good fit for the account but they have limited taps and a few ipas already.','Ogie'),
('532385','2026-10-27','Customer has not had a chance to try the samples i left on my previous visit. Customer is familiar with the products and states that he has had them at the account before but it has been a while. Customer will sample the products and review sales materials to determine if we makes sense for the account','Phillip'),
('CMC-CB3B695E','2026-10-27','Customer is familiar with the brand but wants to focus on more local offerings from breweries like cellarmaker and ghost town for now. At this time he does not believe the product is a good fit for the account but he will keep it in mind moving forward. Customer submits their order for once a month delivery','Chris'),
('535653','2026-10-27','Customer passed along samples to the account owner after my last visit but has yet to hear next steps. Customer will reach out to ownership to see what feedback is but usually no news means, no','Ezy'),
('3235289','2026-10-27','Customer has not gotten around to sampling everything I left on my previous visit but will consult with his assigned representative if he wishes to move forward with investment','AG'),
('534483','2026-10-27','Customer wants to review sales materials on his own and consult with his assigned distributor representative before deciding whether or not to move forward with investment in our brand.','Abdul'),
('3980916','2026-10-27','Ownership received the samples I left on my previous visit but has not communicated whether or not they wish to invest in our brand for the account. They owner does not have a set schedule and his usually here for events at 7-10pm. I reached out again via email to see if the owner could share any feedback on the samples and sales materials I left.','Ben'),
('2013742','2026-10-27','Customer remembers the big daddy ipa but believes that they already have too many ipas. Customer will be meeting with ownership tomorrow and will review samples and sales materials to determine if they believe our brand makes sense for their account.','Jose'),
('3119964','2026-10-27','Customer gave me contact information to reach out to the buyer and set up a meeting to introduce the brand and drop off samples. Sent and email and will follow up accordingly.','Henry'),
('3129046','2026-10-27','Customer gave me contact information to reach out to the buyer and set up a meeting to introduce the brand and drop off samples. Sent and email and will follow up accordingly.','Mike'),
('96287','2026-10-28','Product is full and on the shelf. Account will reorder as needed moving forward.','Whitney'),
('1948540','2026-10-28','Customer approved reinvestment in two more cases of the big daddy ipa. We are currently out of stock at this time. I let the customer know. Product is selling well. Will continue to monitor the account for opportunities','Hector'),
('2918238','2026-10-28','Customer is still interested in the big daddy ipa. The issue right now is that a self distributed brewery gained placement three weeks ago but did not deliver until yesterday. Account owner thought they had forgotten about the account so she now has less space than she originally anticipated. She will reach out to the craft specialist at Markstein to let them know whether or not to send the product this week or not','Sonia'),
('3399674','2026-10-28','Product already tapped. Customer likes to rotate fairly often so he doesnt know the next time that he will bring it in but when it is here it sells well. I will continue to monitor the account for opportunity.','Alfred'),
('4271003','2026-10-28','Customer states that this location is owned by an individual has multiple other bars throughout the east bay. For this location the customer believes that the big daddy ipa would be a great fit, really leveraging the nostalgia of the brand. Account will review sales materials and sample products to determine if we are a good fit for their account','Andrew'),
('4469502','2026-10-28','Samples I left on my previous visit are still behind the bar and have not made it to the account owner yet. Bartender states that he doesnt have the owners email and that the best way to reach him could be to stop by early in the morning before opening','Jeff'),
('4298874','2026-10-28','Customer wants to hold off on adding new products at this time but will keep us in mind moving forward if an opportunity presents itself','Rosa'),
('4873739','2026-10-28','Customer reinvested in a half barrel of the captain save a hop hazy since my previous visit so that is a retroactive sale. Spoke with the buyer and have settled on a pint night date of Thursday 11/12 to support the brand. Account will also invest in the big daddy, pie of the tiger, peachy vibes and metropolis!','Chris Kaiser'),
('532898','2026-10-28','It does not appear that the account owner has had a chance to sample the product i left on my previous visit, i will need to return in a week or so to see if the account has any feedback for me regarding offering our product at their location','Jeff'),
('534248','2026-10-28','Customer invested in the big daddy since my previous visit and will reinvest again this week and expand to offer the metropolis lager!','Holly'),
('3293751','2026-10-28','Big daddy keg was tapped on Monday so we will see how pull through goes and take it from there','Irving'),
('4905718','2026-10-28','Product was pulled from the shelf again by a competitor, went through backstock to locate the product and get it back on the shelf so that it is sellable','Jag'),
('2215286','2026-10-29','Product is not authorized at this time','Ari'),
('96298','2026-10-29','Customer is hesitant to add the big daddy ipa and the captain hazy. Buyer states that they are over saturated with IPAs and that they sell a lot of original pattern and other more local breweries. Customer will review sell sheets and consider our options that are approved by corporate but right now the focus is getting back on track after completing inventory this past week','David'),
('2211938','2026-10-29','Customer states that the best time to reach the buyer is usually on Friday mornings. I will try to swing by tomorrow or next week after i meet up with mark and get fresh samples','Chelsea'),
('2213771','2026-10-29','Customer states that the peachy vibes and the big daddy ipa will have the best shot at making it into the account. Account shared contact information for the buyer and i will try to swing back by next week after i meet with mike and get more samples','Scott'),
('2213870','2026-10-29','Customer states that this could definitely be an option at the account, it''s just a matter of space. They are currently selling through the remainder of the octoberfest beers. The owner is in and out of meetings and it can be hard to nail down a good time to visit but Monday mornings were recommended. I received the owners cell and will reach out or swing by again to gauge responsiveness','Sophia'),
('4386416','2026-10-29','Customer states that he remembers the big daddy ipa and that he will most likely order the product next week on his scheduled day once the octoberfest beers on the tap have probably sold through. He was also interested in the pie of the tiger and will sample it and give me feedback on my next visit. Will wait to claim the placement for now','Mike - Buyer'),
('2213498','2026-10-29','On my previous visit with the buyer he stated that he was interested in the pie of the tiger, doesnt have a sour right now and likes that it is available in sixtels. Going to sample the product and get back to me. Today he is off and wont be back in until tomorrow night. I will reach out again via email','Lydia'),
('3658338','2026-10-29','Customer just received their once a month delivery yesterday. This account writes their own orders. At this time the general manager will sample the product and review sales materials with her beer buyer to identify whether or not we make sense for their account moving forward.','Laura'),
('4664706','2026-10-29','Customer states that this account does not sell that much alcohol. Even with this being a brunch account, the fact that they are vegan focused translates to a more health conscious consumer who does not drink as much as you would expect from a brunch account. At this time he does not see our product making sense for the account and will pass on investment.','John'),
('3627659','2026-10-29','Customer states that in order to gain a tasting appointment I need to email him and the buyer. From there if the customer is interested in the brand they will reach out and we can schedule a time to introduce the brand and our portfolio. At this time he cannot accept any samples. Customer states that If we dont hear back then they are not interested in moving forward.','Ben Somberg'),
('4033539','2026-10-29','Customer states that the account owner is the only one who can approve new items. The owners schedule is not set, so the best way to reach her is via email. The vibe of the bar is very speakeasy like and i can absolutely see our product making sense here. I emailed the owner to try and gauge interest so that I can schedule a meeting. I will revisit in the next couple of weeks to see if I can run into the owner','Tammy'),
('4421381','2026-10-29','I was out of samples at this point but i was able to speak with the buyer and introduce the brand. Customer was familiar with the big daddy ipa and will review sales materials before I return with samples to see if we make sense for the account.','Mariko'),
('4771129','2026-10-30','Visit logged by James (no notes).',null),
('4704895','2026-10-30','Customer does not have an account with our distributor partner and tries to only support local, self distributed products','Cassie'),
('4164526','2026-10-30','I have not heard back from the owner about any of the samples I left on my previous visit and the bartender states that he grabbed the samples but hasnt communicated whether or not he is moving forward with anything. Met mark here. Did training with chad on the new software. Mark left samples. I will reach out via email or text again to see if there is any response.','Terry'),
('2907373','2026-10-30','Product is full and on the shelf. No need to reorder at this time','Lovie'),
('3129050','2026-10-30','Stopped by at 12:15 with mark when I first got to downtown. The bar manager told us the owner should be back around 3pm to setup for the Halloween party they are having. When I returned at 3, the bar manager called the owner to see where they were and they were now not going to be in until 5 ish. I have left samples in the past and shared sales materials and not heard back. This account will require more follow up.','Jamaica')
) as v(outlet_id, d, notes, contact)
join public.sales_accounts a on a.outlet_id = v.outlet_id;

insert into public.sales_account_checkins (outlet_id, checkin_date, rep, activity, outcome, notes, brands, contact, source)
select v.outlet_id, v.d::date, 'James',
       case a.premise when 'On' then 'On Premise Visit' when 'Off' then 'Off Premise Visit' else 'Field Visit' end,
       'Committed', 'Commitment logged by James.', 'Committed: ' || v.brands, null, 'CMC: James weekly recap'
from (values
('4873739','2026-10-28','Big Daddy IPA 1/2 Barrel Keg; Full Circle Apricot Pie of the Tiger 1/2 Barrel Keg; Full Circle Captain Save a Hop Hazy IPA 1/2 Barrel Keg; Full Circle Captain Save a Hop West Coast IPA 1/2 Barrel Keg'),
('534248','2026-10-28','Big Daddy IPA 1/6 Barrel Keg; Full Circle Apricot Pie of the Tiger 1/6 Barrel Keg'),
('3778878','2026-10-26','Big Daddy IPA 12 pack 19.2oz Cans'),
('1948540','2026-10-28','Big Daddy IPA 12 pack 19.2oz Cans (2 cases)')
) as v(outlet_id, d, brands)
join public.sales_accounts a on a.outlet_id = v.outlet_id;

commit;

-- Result: expect 50 visits + 4 commitments = 54 for the week
select
  (select count(*) from public.sales_account_checkins where source = 'CMC: James weekly recap' and checkin_date between '2026-10-25' and '2026-11-01') as james_week_checkins,
  (select count(*) from public.sales_account_checkins where source like 'CMC: James%') as james_all_checkins;
