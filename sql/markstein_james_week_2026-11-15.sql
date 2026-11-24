-- James Mendoza (CMC) -> Markstein check-ins, week 11/15-11/22/2026 (2026-11-23, per Chad).
-- From James's Monday email "Full Circle Brewing Weekly Recap 11.15-11.22" (11/23; he was on PTO Mon 11/16):
-- the "Full Circle WR 11.15-11.22.docx" visits (40, 11/17-11/20) + "Full Circle CC's 11.15-11.22.xlsx"
-- commitments (9 lines, 7 accounts). Same rules as sql/markstein_james_week_2026-11-08.sql:
--   * every store matched to its account (street number + street + city, then name checked by hand)
--     against the live account list (read-only SELECT, 11/23). No same-store-same-day repeats this week;
--     Round Table Pizza Concord visited 11/18 and 11/20 (kept both).
--   * 1 store not in the account list added as a Markstein prospect ("CMC-" id):
--     Hops and Grapes, 24 W 10th St, Antioch (TETOS PLACE at 22 W 10th is a different store)
--   * every account James visited set to distributor Markstein. Two were Geyser:
--     ROCKYS MARKET 2214106 (Oakland) and UPTOWN MARKET & LIQUORS 540653 (Oakland)
--   * visits = rep "James", outcome "Visited", On/Off Premise from the account
--   * commitments = a separate "Committed" check-in with what he committed to.
--     "Black History Month 6/4 16oz" (Alameda Natural Grocery) = Pitchfork Pear Cider 4-packs (James's email).
--     Asa's "Captain Save a Hop Hazy 19.2" = Mystic Haze 19.2 (his visit notes say mystic haze).
-- Judgment matches: Jack's Taps (60 Crescent Dr) -> JACKS RESTAURANT 3244172 (James's earlier check-ins);
--   Urban Plates (same address) -> URBAN PLATES 3969832; Doppio Zero -> CMC-FD2427A4 (James's earlier
--   check-in; not PRIMA 2213868 at the same address); Mona's -> MONAS BURGERS 3995431;
--   Bill & Bali's -> PEETZA PIES & PINTS 4914576; Blast and Brew -> CMC-BLASTBRW; Hop Grenade -> 3675408;
--   Legends at Diablo Creek -> LEGENDS & HEROES 2933040; Skipolini's Concord -> 2938158.
-- Safe to run more than once: first removes James's recap check-ins dated 11/15-11/22.
-- Run in Supabase's SQL Editor.

begin;

insert into public.sales_accounts (outlet_id, name, address, city, state, distributor, premise, report_note) values
('CMC-7EA5A866','Hops and Grapes','24 W 10th St','Antioch','CA','Markstein','On','Added from James''s (CMC) visits — not in the account list yet.')
on conflict (outlet_id) do nothing;

update public.sales_accounts set distributor = 'Markstein', updated_at = now()
where outlet_id in ('96297','2211814','2870619','2925461','534055','4540596','530866','532539','534733','538512','3759699','4416028','4914576','2210862','3946971','3998631','3244172','538958','3995431','3969832','2214106','4062564','2354271','2904732','530941','540653','3196529','CMC-FD2427A4','2013742','3119964','2934563','533001','2355812','2938158','3675408','CMC-BLASTBRW','2933040','1948985','CMC-7EA5A866')
  and distributor is distinct from 'Markstein';

delete from public.sales_account_checkins
where source = 'CMC: James weekly recap'
  and checkin_date between date '2026-11-15' and date '2026-11-22';

insert into public.sales_account_checkins (outlet_id, checkin_date, rep, activity, outcome, notes, brands, contact, source)
select v.outlet_id, v.d::date, 'James',
       case a.premise when 'On' then 'On Premise Visit' when 'Off' then 'Off Premise Visit' else 'Field Visit' end,
       'Visited', v.notes, null, v.contact, 'CMC: James weekly recap'
from (values
('96297','2026-11-17','Captain hazy and big daddy are still half full or more and on the shelf. The big daddy placement in the cooler continues to move as it appears they are resetting the cooler fairly frequently. Spoke with the buyer and let her know that the big daddy 19.2s are in stock and to order at least 2 cases because of how well it sold since we placed it in the cooler.','Jessica'),
('2211814','2026-11-17','Customer is interested in both the cider and the mystic haze. Customer states that if he has space he will bring in the mystic haze for sure and he will review sales materials for the cider and keep it in consideration if any opportunities present itself moving forward. Wont claim until product lands for now',null),
('2870619','2026-11-17','Customer states that test scanning doesnt show if the items is authorized or not and at this time the account is only focused on items that are in the schematic. For now it is a no','Nancy'),
('2925461','2026-11-17','Customer has the big daddy six packs and will invest in the pitchfork cider on their order for delivery this Thursday','Mary Angel'),
('534055','2026-11-17','This account is currently being sold and all orders are on hold until the transfer is complete','Faid'),
('4540596','2026-11-17','Product is currently being sold as singles at this time. The pie, captain hazy and the big daddy 12 oz are all being sold one can at a time. Did a reset to get all of the products together on the shelf and the account will take time to consider and evaluate the 19.2 options and 4 pack cider',null),
('530866','2026-11-17','Customer states that business is slow and that they are passing on investment for new items at this time, the accounts main focus is sell through right now','Mohammed'),
('532539','2026-11-17','Customer has both the captain hazy and pie of the tiger on the shelf. Due to their slower sales performance the account does not wish to invest in the big daddy or mystic haze in any format. Account will consult with assigned distributor representative about pear cider but buyer states they lack the space to expand and offer new items at this time','Yvonne'),
('534733','2026-11-17','Customer has 2 units of the big daddy six pack remaining on the shelf. At this time there is no need to reinvest. The movement is slow and the customer states it sold better when it was in bottles. Account will consult with assigned distributor representative about our other items that are available to determine what makes sense for their account, more focus will be placed on the pitchfork cider','Subash'),
('538512','2026-11-18','Customer is awaiting new shelving for the back end cap and wants to wait until he has transitioned everything over to see what he wants to continue to offer and what he wants to get rid of. At this time account is not investing in any new products not in the schematic. I did test scan the big daddy, captain hazy and pie at the register and they all came up with pricing but management states that does not mean it is authorized and the only way to know is to send it through on an invoice, so for now we will wait and I will check back in later','Clint'),
('3759699','2026-11-18','Customer sold out of the big daddy ipa and said it did well. He plans to reinvest either the week after thanksgiving or the week after that, he has some back up kegs to clear through and the account will be closed more than it will be open over the next few weeks.','Paul'),
('4416028','2026-11-18','Customer states that her customers loved the big daddy ipa and that it sold quickly. Account will reinvest in another sixtel of the big daddy and expand to offer the pie of the tiger in sixtel format as well!','Sydney'),
('4914576','2026-11-18','Customer sampled out the product to his regulars and they really enjoyed the captain hazy. Going to wait for the current hazy to sell through and give the account a chance to sell through the back up keg before hopefully converting to a placement on the six tap system','Sim'),
('2210862','2026-11-18','Customer already committed to another product for her rotator at this account. She states that it sold out and that it did well but she is locked in on other products for now. She did however approve a sixtel for the big daddy ipa at this accounts sister location wise girls in pleasant hill','Julie'),
('3946971','2026-11-18','This accounts buyer is the same as back forty. Customer approved investment in a sixtel of the big daddy IPA for the next scheduled delivery','Julie'),
('3998631','2026-11-18','Customer has two 4 packs of the captain hazy remaining on the shelf and will reorder as needed. When asked about the big daddy ipa customer states that it is no longer authorized and that if it was he still wouldn''t want it because of how many negative experiences he had with exploding cans. Customer states they would just burst for no reason and this happened with product from three separate deliveries years ago. For this account it is a no','Matt'),
('3244172','2026-11-18','Customer states that he is not interested in the big daddy ipa and the captain save a hop hazy because he has access to more local breweries with great products, he is however interested in the pie of the tiger and the peachy vibes. Customer believes that these are a better fit for the account and are more likely to gain placement pending sampling. Left another can of each for the buyers consideration and will revisit in another couple of weeks.','Brett'),
('538958','2026-11-18','Customer submits his order next week with markstein. Account only has one tap available. Customer will sample over the next week and see what he thinks makes sense for his account','Ali'),
('3995431','2026-11-18','Customer sampled the product I left on my last visit and is not interested in moving forward with investment at this time','Moe'),
('3969832','2026-11-18','Normal point of contact has already left for the day. Left samples of the big daddy, pie and peachy vibes. Sent an email to let him know i stopped by and who i left samples with. Customer had mentioned that he wanted to rotate in a heavier beer in winter time so thats why i returned today with samples. Will wait for feedback','Dylan'),
('2214106','2026-11-19','Customer approved investment in the big daddy six packs on his next scheduled delivery','Adam'),
('4062564','2026-11-19','Customer does not believe that the speakeasy beers are a good fit for his account. He states that he has an abundance of choice from more local breweries and that at this time he doesnt think we make sense for the account. He did state however that the sours from full circle are on his mind but that it is something that will take time because the image of our brands is not what they used to be. I will continue to monitor the account for opportunities','Jesse'),
('2354271','2026-11-19','Product was moved across multiple sections, i did a quick reset to get our SKUs back together on the shelf with POS. At this time there is no need to reorder, shelf is full. I will revisit the account in a month or so to assess sell through.','Kulwinder'),
('2904732','2026-11-19','Customer remembers the brand and would like to start with a case of the mystic haze and a case of the big daddy six packs on his next scheduled delivery Customer approved big daddy six packs and mystic haze singles and pre approved the pie of the tiger and captain save a hop hazy as soon as they are back in stock. I will claim those once they drop','Abdul'),
('530941','2026-11-19','Account has big daddy 16 oz and pie of the tiger 16 oz in the store already. Normal point of contact and buyer is out of town right now. Left a message and texted to inquire about his willingness to reinvest and or expand to offer more of the portfolio in different package sizes','Alex'),
('540653','2026-11-19','Customer states that he has had bad experiences with our products in the past and that he is not interested in offering any of our SKUs at his account','NP'),
('3196529','2026-11-19','Jake left samples with ownership and has not heard anything back at this time. All new items have to be approved by ownership before any placements can occur. When I asked for the owners contact information they were not able to locate any more business cards. I will look on the restaurant website to see if there is a general email I can use to contact the true decision maker at the account.','Maria'),
('CMC-FD2427A4','2026-11-19','Customer states that the owner of the restaurant did grab the samples but has been preoccupied with the opening of another restaurant location in Livermore. Account requests that I revisit in a couple weeks after things have settled down and the owner will most likely be back at this location','Veronica'),
('2013742','2026-11-19','Customer states that I should not expect or hope to get anything new into the account until they secure a new location. Customer states that technically the account received an eviction notice on 10/1 and they are waiting until a judge forces them to leave which would mean closing permanently or finding another location they can afford. All new items are approved by the owner Saul and he is currently not ordering much with all of the looming factors at this time.','Andrew'),
('3119964','2026-11-19','Customer states that the buyer relayed that business is too slow at this time to consider adding new items. It is currently taking 3 weeks to sell through kegs of their top beers so it would be better to circle back to the account after the new year at this time.','Henry'),
('2934563','2026-11-20','Customer will reinvest in the big daddy 19.2s on his next order in two weeks since he doubled up for the holiday next week. Currently sold out but POS is still up','David'),
('538958','2026-11-20','Returned today at noon as requested to go in depth on the portfolio and the owner did not show due to injury. At this time I think it will be beneficial to give this account some time and focus on others in the area','Ali'),
('533001','2026-11-20','Normal point of contact was not in. Will revisit after the holiday to gauge interest into the mystic haze 19.2 as well as our 4 pack craft options. Both the big daddy singles and six packs are full and on the shelf with POS','AJ'),
('2355812','2026-11-20','Customer remembers selling a good amount of big daddy but at this time the account is focusing on offering other items besides the abundance of beer that they already have. At this time it''s a no but they will keep us in mind moving forward. I will continue to monitor the account for opportunities','Vinnie'),
('2938158','2026-11-20','Customer is focused on maintaining their current inventory and is not interested in expanding to offer new items at this time','Jose'),
('3675408','2026-11-20','Account was busier than usual but i was able to secure an official meeting with the buyer on Monday the 30th.','Lewis'),
('CMC-BLASTBRW','2026-11-20','At this time the account owner has been inundated with offerings from all over. He is committed to giving everyone a fair shot and at this time needs time to clear through his back log. This is a once a month account with a web order designation. I will be contacting the account owner in 2 weeks via his request to see if there is anything else that he needs from our distributor partner and hopefully gaining a placement of metropolis, peachy vibes or pie since the feedback he has received lately is that he has too many ipas','Pritpal'),
('2933040','2026-11-20','Customer states that at this time she wants to hold off on adding anymore new items until late January early February. The account is focused on making it through the holidays first and reassessing their offerings/menu afterwards.','Rebecca'),
('1948985','2026-11-20','Customer is eyeing replacing the peroni that is on tap, but also states they have a hazy backfilled for that handle already. Customer asks to revisit early next year to consider transitioning to the big daddy ipa. Mentioned to consult with his counterpart at the Oakley location who can vouch for sales performance and consumer satisfaction.','Daniel'),
('CMC-7EA5A866','2026-11-20','The account is going to be transitioning out of the lost coast taps that they currently have. The beers that they are most interested in are the pie of the tiger and the big daddy ipa. Left samples and shared sales materials. Account will evaluate both and decide whether or not we are a good fit for them moving forward.','Humberto')
) as v(outlet_id, d, notes, contact)
join public.sales_accounts a on a.outlet_id = v.outlet_id;

insert into public.sales_account_checkins (outlet_id, checkin_date, rep, activity, outcome, notes, brands, contact, source)
select v.outlet_id, v.d::date, 'James',
       case a.premise when 'On' then 'On Premise Visit' when 'Off' then 'Off Premise Visit' else 'Field Visit' end,
       'Committed', 'Commitment logged by James.', 'Committed: ' || v.brands, null, 'CMC: James weekly recap'
from (values
('2925461','2026-11-17','The Pitchfork - Pear Cider 4-packs (entered in CMC as Black History Month 6/4 pack 16oz — James: no Pitchfork option in CMC)'),
('96297','2026-11-17','Big Daddy IPA 12 pack 19.2oz Cans (2 cases)'),
('4416028','2026-11-18','Big Daddy IPA 1/6 Barrel Keg; Apricot Pie of the Tiger 1/6 Barrel Keg'),
('3946971','2026-11-18','Big Daddy IPA 1/6 Barrel Keg'),
('2904732','2026-11-19','Big Daddy IPA 4/6 pack 12oz Cans; Mystic Haze IPA 12 pack 19.2oz Cans (entered in CMC as Captain Save a Hop Hazy 19.2)'),
('2214106','2026-11-19','Big Daddy IPA 4/6 pack 12oz Cans'),
('2934563','2026-11-20','Big Daddy IPA 12 pack 19.2oz Cans (on his order in ~2 weeks)')
) as v(outlet_id, d, brands)
join public.sales_accounts a on a.outlet_id = v.outlet_id;

commit;

-- Result: expect 40 visits + 7 commitments = 47 for the week
select
  (select count(*) from public.sales_account_checkins where source = 'CMC: James weekly recap' and checkin_date between '2026-11-15' and '2026-11-22') as james_week_checkins,
  (select count(*) from public.sales_account_checkins where source like 'CMC: James%') as james_all_checkins;
