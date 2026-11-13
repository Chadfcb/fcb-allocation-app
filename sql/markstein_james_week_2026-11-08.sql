-- James Mendoza (CMC) -> Markstein check-ins, week 11/8-11/15/2026 (2026-11-13, per Chad).
-- From James's Friday email "Full Circle Weekly Recap 11.8-11.15" (11/13 — he's off
-- Fri 11/13 + Mon 11/16): the "Full Circle WR 11.8-11.15.docx" visits + "Full Circle
-- CC's 11.8-11.15.xlsx" commitments. Same rules as sql/markstein_james_week_2026-10-25.sql:
--   * every store matched to its account (street number + city, then name checked by hand);
--     same store + same day counted once (Sunbeam 11/12 and Encinal 11/12 were each entered twice)
--   * 1 store not in the account list added as a Markstein prospect ("CMC-" id):
--     Berkeley Organic Market & Deli, 2642 Ashby Ave (CASA DO PETISCO at that address is a restaurant)
--   * every account James visited set to distributor Markstein (all already were)
--   * visits = rep "James", outcome "Visited", On/Off Premise from the account
--   * commitments = a separate "Committed" check-in with what he committed to.
--     James: Mystic Haze 19.2s were entered in CMC's system as "Captain Save a Hop Hazy 19.2"
--     (no Mystic Haze option) — recorded here as Mystic Haze.
--     Park Station pint night (6 half-barrels) is from the email, not his commitments list.
-- Judgment matches: Seven Palms (1801 Euclid; email calls it "Golden Bear") -> SEVEN PALMS FOOD
--   CENTER 539348 (James's earlier check-in is there; GOLD BAER 4772382 same address);
--   Courtyard by Marriott Concord (45 John Glenn Dr) -> CONCORD PLAZA HOTEL 4862669 (same address);
--   Dragon Dive -> 4885647 (not RED DRAGON 2936686); Tipsy Yeti -> 4816651 (not LONGBRANCH).
-- Safe to run more than once: first removes James's recap check-ins dated 11/8-11/15.
-- Run in Supabase's SQL Editor.

begin;

insert into public.sales_accounts (outlet_id, name, address, city, state, distributor, premise, report_note) values
('CMC-C719B3F9','Berkeley Organic Market & Deli','2642 Ashby Ave','Berkeley','CA','Markstein','Off','Added from James''s (CMC) visits — not in the account list yet.')
on conflict (outlet_id) do nothing;

update public.sales_accounts set distributor = 'Markstein', updated_at = now()
where outlet_id in ('2012939','2016507','2017519','2144741','2211089','2213870','2214657','2215330','2352857','2747837','2915444','2931789','2935800','2937177','2982881','2983660','3034615','3168285','3660546','4005111','4153484','4373469','4386416','4697313','4800114','4816651','4862669','4873739','4885647','4907293','4908904','4914576','530864','531548','532864','533635','533985','535783','536745','536848','537175','539348','540820','96298','CMC-C719B3F9')
  and distributor is distinct from 'Markstein';

delete from public.sales_account_checkins
where source = 'CMC: James weekly recap'
  and checkin_date between date '2026-11-08' and date '2026-11-15';

insert into public.sales_account_checkins (outlet_id, checkin_date, rep, activity, outcome, notes, brands, contact, source)
select v.outlet_id, v.d::date, 'James',
       case a.premise when 'On' then 'On Premise Visit' when 'Off' then 'Off Premise Visit' else 'Field Visit' end,
       'Visited', v.notes, null, v.contact, 'CMC: James weekly recap'
from (values
('2915444','2026-11-09','Customer will reinvest in the big daddy six packs and expand to offer the big daddy 19.2s. We are working on immediate cold box placement to give the product the best visibility and chance to sell through','Kevin'),
('3660546','2026-11-09','Customer did not have time to speak, she was busy setting up for an event taking place at her account. I will try to revisit again later this week or next so that we can converse on opportunities. There is space in the pre pack cooler and the tap list could absolutely use a refresh, there are some products there that i believe we can replace','Elise'),
('540820','2026-11-09','Normal point of contact is off today and the owner has not responded to my text, going to have to swing by again later on this month to gain feedback on our portfolio at the account','Sanu'),
('4908904','2026-11-09','Customer has a new pre pack fridge but believes that it is already too full. Customer is trying to establish a fairly set tap list where 3 of the taps will be semi permanent and one will rotate. He has the next two IPAs selected to rotate on and states he will consider the big daddy and captain hazy for the one after that if he believes they makes sense after sampling','Chris'),
('532864','2026-11-09','Customer states that the owner has the final say in all new items but that he has been busy as of late. The account owner has no set schedule and will drop in whenever he is free. At this time he will pass along the samples and my contact information and we will build from there. The hope is that the account owner will notice how successful we are at his convenience store and add us to this bar.','Christian'),
('533635','2026-11-09','Dropped off some fresh samples with john for the accounts consideration. The SKUs i think that are most likely to convert would be big daddy and possibly peachy vibes. Customer will sample the product and review sales materials with ownership to evaluate whether or not we make sense for their account moving forward','John'),
('4005111','2026-11-09','Customer states that he will research the product more on his own and consult with his assigned distributor representative to determine whether or not our product makes sense for his account moving forward','Sean'),
('2935800','2026-11-09','Customer is interested in the pear cider and the big daddy ipa, captain save a hop and peachy vibes. The issue is what would have to come off of the tap offerings and I took aim at the lagunitas little sumpin which the customer stated is a rotating tap and she believes has slowed down in terms of sales velocity but will check her records to determine. Customer will sample product and review sales materials to determine if any of these 4 products make sense for her account moving forward and take it from there','Kim'),
('4373469','2026-11-09','Customer only has a 3 door set and does not believe that he has enough space to add anything new at this time that is a larger package size than a 19.2 oz single, and even that will be a stretch. He remembers the big daddy and will consult with his assigned distributor representative to possibly add it to his order but he states that he must find space first','Rex'),
('535783','2026-11-09','Product has been slower than originally anticipated. At this time the customer does not wish to reinvest or expand until sell through increases','Bishal'),
('4885647','2026-11-09','Customer has sold through the inventory of the big daddy ipa however the buyer is not in. I will reach out via text to see if they would like to reinvest or try a different item that i have left samples for.','Julia'),
('2017519','2026-11-09','Customer states that single unit sales are what is moving right now for his account and that the six pack or larger packaging has been very slow. At this time he does not wish to invest in the brands larger options like the 4 packs and 6 packs but has approved investment in both the big daddy and mystic haze 19.2s for delivery this Thursday','Gil'),
('2012939','2026-11-09','Account just sold to its new owner last week. Met the owner and introduced myself and the brand. At this time they are focused on trying to learn what sells but they remember the big daddy name and will start with the 19.2s of that and the mystic haze on their next available delivery','Joshie sunny'),
('2016507','2026-11-09','Customer received his prior commitments and sold out. He will now reinvest in both big daddy six packs and singles as well as expanding to offer the mystic haze singles on his next available delivery','Aziz'),
('2352857','2026-11-09','The owner is not in today. Left another can of the big daddy and the peachy vibes which would be a great fit for the account. Never received feedback from the owner on what he thought of the first sample i left him. Will revisit again later this month','Liz'),
('4153484','2026-11-09','Customer will consult with the store owner to see if they believe that our product makes sense for their account moving forward. Employee did not remember the brand.','Ali'),
('4800114','2026-11-10','Buyer has a separate room for backstock that is in addition to the walk in cooler that i had been pulling from to replenish the cooler on previous visits. The accounts once a month scheduled delivery has already past and at this time is comfortable waiting to reorder until it is their turn again.','Jeffery'),
('531548','2026-11-10','Introduced the Sonoma cider pitchfork and the mystic haze from speakeasy. Customer is considering replacing a competitors sku with both big daddy and mystic haze. I mentioned that we only have 8 cases left and that if he wants it he should order it through his portal before it''s gone. Also going to consider bringing back in the big daddy six packs. Both captain hazy and pie are doing fairly well. Customer will order as needed','Steve'),
('539348','2026-11-10','Customer is sold out of any and all full circle/ speakeasy products from what i can see. At this time the customer will reinvest in the big daddy 19.2s however will pass on the mystic haze, Sonoma cider and other full circle beer offerings due to lack of space.','Michael'),
('4907293','2026-11-10','Customer has 2 four packs remaining of the pitchfork cider on the shelf. No other products from us that i could locate on the shelf. Account submits their own order online. The order writer floats between their other store locations especially the one they are preparing to open in downtown Walnut Creek. I called and left a message','Jot'),
('536848','2026-11-10','Customer is familiar with our brands and states that he is interested in both the big daddy and mystic haze but will wait to consult with his assigned distributor representative on his scheduled order day next week','Kay'),
('4816651','2026-11-10','Customer wants to hold off on reinvestment for now. He wants to give it more time before he rotates us back in to the account. Aiming at replacing the Sam Adam''s octoberfest once it kicks. Big daddy is the play here. Not a big cider account, Cali squeeze fulfills the wheat ales, fathers fulfills the lager, not interested in sours and our biggest competition ipa wise is from fieldwork and racer 5. I will continue to visit the account for opportunities','Sujan'),
('537175','2026-11-10','Customer has not had a chance to sample everything yet, i will reach out to the buyer again to see if they can provide any feedback.','Teresa'),
('3034615','2026-11-10','Customer is not interested in the products at this time and believes that they did not sell well enough.','Patrick'),
('CMC-C719B3F9','2026-11-10','Buyer and main point of contact is not in , i will reach out via email to gauge interest in our products. I believe the big daddy. Singles would do great here.','Ian'),
('2747837','2026-11-10','Customer is awaiting funding from corporate to have their glycol chiller/taps repaired and get them back up to 7 taps. I will continue to build rapport and maintain my relationship with the buyer in hopes that we will be the first brand he thinks of once opportunity arises.','Anthony'),
('4914576','2026-11-10','Product is available in the grab and go cooler as a single and 4pk for on and off premise consumption. At this time the customer is still debating our other product offerings but i believe that the big daddy and mystic haze pre pack and the captain hazy and big daddy or peachy vibes draft would do well here. Left samples of cider, cap and big daddy',null),
('2982881','2026-11-11','Assigned distributor representative was on vacation when i received the prior commitment and the account skipped their last scheduled delivery. I believe we will be able to close out the commitments on the next scheduled delivery','Adrian Perez'),
('2211089','2026-11-11','Shares sell sheets and the customer will review on his own and consult with his assigned sales representative to see which product makes sense for his account moving forward','Neil'),
('3168285','2026-11-11','Dropped off samples of the big daddy, pie of the tiger, peachy vibes and pitchfork. Customer states that he really isnt looking for any new products but the one he is most interested in is pie of the tiger. Our competitor is almanac in this category, if he likes it he will reach out','Erik'),
('2983660','2026-11-11','Customer will invest in a case of the mystic haze 19.2s on his next scheduled delivery','Mahesh'),
('2937177','2026-11-11','Customer states that all new items must be approved by his area manager, Cindy and that he will pass along my contact information and sales materials to see if she believes any of our items make sense for their account moving forward.','Harry'),
('2215330','2026-11-11','Customer has the captain hazy on the shelf right now and will expand to offer the big daddy ipa in both 6pk and 19 oz format.','Rahul'),
('4697313','2026-11-11','The account is restructuring so i will have a new point of contact/order writer to communicate with during my visits. The new order writer is not in but the old buyer will share my contact info so that we can touch base. Left samples','LC'),
('4862669','2026-11-11','Met with the person in charge. The buyer is also in charge of the lesher center in downtown Walnut Creek and the new restaurant at the Brendan movie theaters. Customer will review sales materials and consult with his business partners','Reyes'),
('96298','2026-11-12','Customer is still hesitant to add the big daddy ipa and the captain hazy. Buyer states that they are over saturated with IPAs and that they sell a lot of original pattern and other more local breweries. For now it is a no but i will continue to monitor the account for opportunities','David'),
('2213870','2026-11-12','Customer has asked me to share all the sell sheets with him via email so that he can review them on Wednesdays when he writes his orders. He states that is the best way to reach him when it comes to new items','Wes'),
('4386416','2026-11-12','Customer still needs to consult with his business partner to see how he feels about the addition of the big daddy ipa, customer states that business has slowed and they need something to kick for them to be able to try something new. The other buyer should be in around 4 pm so the buyer asked me to text him to see final feedback','Mike - Buyer'),
('2214657','2026-11-12','Customer approved reinvestment in the big daddy six packs which there are only one unit remaining on the shelf and expansion to offer the mystic haze. The big daddy singles still have 6 units on the shelf from their initial investment and 2 units of each 4 pack remaining. At this time the customer wants those to sell through more before considering reinvestment.','Ali'),
('2144741','2026-11-12','Customer remembers the big daddy ipa. Account approved investment in both the big daddy and mystic haze singles for their order tomorrow. We will revisit other SKUs after the brand has a chance to sell through at the account, right now there is not any wiggle room in the cooler to add anything bigger than 19.2s','Ala'),
('536745','2026-11-12','The big daddy singles are full and on the shelf, the six packs have 2 remaining. The pie of the tiger has 4 four packs and the captain hazy has 5 on the shelf. At this time the account wants to sell through their current inventory but if the mystic haze is still in stock next week they will take a case.','Rico'),
('2931789','2026-11-12','Customer is going to start with a case of the big daddy 19.2s and take it from there. Left samples of other SKUs and will revisit to see what sales performance looks like at the account.','Demetri'),
('533985','2026-11-12','I havent received any feedback from the buyer at this account on the samples that i left on my previous visits. The buyer has already headed home for the day so i will reach out next week to gauge interest in our offerings.','Arturo'),
('530864','2026-11-12','Customer has 2 six packs of the big daddy remaining on the shelf but approved reinvestment on his next available delivery. Customer will keep the 19.2s in mind moving forward','Manny'),
('4873739','2026-11-12','Pint night','Chris Kaiser')
) as v(outlet_id, d, notes, contact)
join public.sales_accounts a on a.outlet_id = v.outlet_id;

insert into public.sales_account_checkins (outlet_id, checkin_date, rep, activity, outcome, notes, brands, contact, source)
select v.outlet_id, v.d::date, 'James',
       case a.premise when 'On' then 'On Premise Visit' when 'Off' then 'Off Premise Visit' else 'Field Visit' end,
       'Committed', 'Commitment logged by James.', 'Committed: ' || v.brands, null, 'CMC: James weekly recap'
from (values
('530864','2026-11-12','Big Daddy IPA 4/6 pack 12oz Cans'),
('2915444','2026-11-09','Big Daddy IPA 12 pack 19.2oz Cans; Big Daddy IPA 4/6 pack 12oz Cans'),
('2012939','2026-11-09','Big Daddy IPA 12 pack 19.2oz Cans; Mystic Haze IPA 12 pack 19.2oz Cans (entered in CMC as Captain Save a Hop Hazy 19.2)'),
('2983660','2026-11-11','Mystic Haze IPA 12 pack 19.2oz Cans (entered in CMC as Captain Save a Hop Hazy 19.2)'),
('2931789','2026-11-12','Big Daddy IPA 12 pack 19.2oz Cans'),
('536745','2026-11-12','Mystic Haze IPA 12 pack 19.2oz Cans (entered in CMC as Captain Save a Hop Hazy 19.2)'),
('2016507','2026-11-09','Big Daddy IPA 12 pack 19.2oz Cans; Big Daddy IPA 4/6 pack 12oz Cans; Mystic Haze IPA 12 pack 19.2oz Cans (entered in CMC as Captain Save a Hop Hazy 19.2)'),
('539348','2026-11-10','Big Daddy IPA 12 pack 19.2oz Cans'),
('2144741','2026-11-12','Big Daddy IPA 12 pack 19.2oz Cans; Mystic Haze IPA 12 pack 19.2oz Cans (entered in CMC as Captain Save a Hop Hazy 19.2)'),
('2017519','2026-11-09','Big Daddy IPA 12 pack 19.2oz Cans; Mystic Haze IPA 12 pack 19.2oz Cans (entered in CMC as Captain Save a Hop Hazy 19.2)'),
('2214657','2026-11-12','Big Daddy IPA 4/6 pack 12oz Cans; Mystic Haze IPA 12 pack 19.2oz Cans (entered in CMC as Captain Save a Hop Hazy 19.2)'),
('2215330','2026-11-11','Big Daddy IPA 12 pack 19.2oz Cans; Big Daddy IPA 4/6 pack 12oz Cans'),
('4873739','2026-11-12','6 half-barrels for the Full Circle Pint Night 11/12 (from James''s email; not in his commitments list)')
) as v(outlet_id, d, brands)
join public.sales_accounts a on a.outlet_id = v.outlet_id;

commit;

-- Result: expect 45 visits + 13 commitments = 58 for the week
select
  (select count(*) from public.sales_account_checkins where source = 'CMC: James weekly recap' and checkin_date between '2026-11-08' and '2026-11-15') as james_week_checkins,
  (select count(*) from public.sales_account_checkins where source like 'CMC: James%') as james_all_checkins;
