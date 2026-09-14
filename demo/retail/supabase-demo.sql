-- PUBLIC LICENSED DEMO DATA ONLY. Do not use this policy for private customer tables.
-- Chen, D. (2015), Online Retail, UCI, CC BY 4.0; see provenance.json.
-- Creates a new table; fails if the name exists. Does not modify an existing table.
begin;
create table public.reprosafe_retail_demo (
    id bigint generated always as identity primary key,
    row text not null,
    reference text not null
);
alter table public.reprosafe_retail_demo enable row level security;
revoke all on public.reprosafe_retail_demo from anon, authenticated;
grant select on public.reprosafe_retail_demo to anon, authenticated;
create policy "Public licensed demo read" on public.reprosafe_retail_demo
    for select to anon, authenticated using (true);
insert into public.reprosafe_retail_demo (row, reference) values
('"AIRLINE LOUNGE,METAL SIGN",420', 'customer-15311/invoice-536381/line-111'),
('WHITE HANGING HEART T-LIGHT HOLDER,1530', 'customer-17850/invoice-536365/line-2'),
('"FANCY FONT BIRTHDAY CARD, ",1008', 'customer-13408/invoice-536394/line-255'),
('WHITE METAL LANTERN,2034', 'customer-17850/invoice-536365/line-3'),
('"TRAY, BREAKFAST IN BED",1275', 'customer-14729/invoice-536520/line-958'),
('CREAM CUPID HEARTS COAT HANGER,2200', 'customer-17850/invoice-536365/line-4'),
('"SWISS ROLL TOWEL, CHOCOLATE  SPOTS",295', 'customer-14729/invoice-536520/line-1016'),
('KNITTED UNION FLAG HOT WATER BOTTLE,2034', 'customer-17850/invoice-536365/line-5'),
('"SWISS ROLL TOWEL, CHOCOLATE  SPOTS",1770', 'customer-17572/invoice-536524/line-1085'),
('RED WOOLLY HOTTIE WHITE HEART.,2034', 'customer-17850/invoice-536365/line-6'),
('"BIRTHDAY CARD, RETRO SPOT",1008', 'customer-15485/invoice-536531/line-1216'),
('SET 7 BABUSHKA NESTING BOXES,1530', 'customer-17850/invoice-536365/line-7'),
('"FANCY FONT BIRTHDAY CARD, ",1008', 'customer-15485/invoice-536531/line-1217'),
('GLASS STAR FROSTED T-LIGHT HOLDER,2550', 'customer-17850/invoice-536365/line-8'),
('"FANCY FONT BIRTHDAY CARD, ",504', 'customer-12433/invoice-536532/line-1259'),
('HAND WARMER UNION JACK,1110', 'customer-17850/invoice-536366/line-9'),
('"FEATHER PEN,COAL BLACK",2040', 'customer-17873/invoice-536559/line-2106'),
('HAND WARMER RED POLKA DOT,1110', 'customer-17850/invoice-536366/line-10'),
('"FEATHER PEN,LIGHT PINK",1020', 'customer-17873/invoice-536559/line-2107'),
('ASSORTED COLOUR BIRD ORNAMENT,5408', 'customer-13047/invoice-536367/line-11'),
('"FEATHER PEN,LIGHT PINK",1020', 'customer-17873/invoice-536559/line-2108'),
('POPPY''S PLAYHOUSE BEDROOM ,1260', 'customer-13047/invoice-536367/line-12'),
('"FEATHER PEN,COAL BLACK",1020', 'customer-17873/invoice-536559/line-2109'),
('POPPY''S PLAYHOUSE KITCHEN,1260', 'customer-13047/invoice-536367/line-13'),
('"FEATHER PEN,HOT PINK",1020', 'customer-17873/invoice-536559/line-2110'),
('FELTCRAFT PRINCESS CHARLOTTE DOLL,3000', 'customer-13047/invoice-536367/line-14'),
('"ART LIGHTS,FUNK MONKEY",1770', 'customer-13468/invoice-536562/line-2143'),
('IVORY KNITTED MUG COSY ,990', 'customer-13047/invoice-536367/line-15'),
('"NURSERY A,B,C PAINTED LETTERS",675', 'customer-16274/invoice-536569/line-2188'),
('BOX OF 6 ASSORTED COLOUR TEASPOONS,2550', 'customer-13047/invoice-536367/line-16'),
('"CHRISTMAS GARLAND STARS,TREES",375', 'customer-16274/invoice-536569/line-2226'),
('BOX OF VINTAGE JIGSAW BLOCKS ,1485', 'customer-13047/invoice-536367/line-17'),
('"FEATHER PEN,COAL BLACK",1020', 'customer-14606/invoice-536591/line-2445'),
('BOX OF VINTAGE ALPHABET BLOCKS,1990', 'customer-13047/invoice-536367/line-18'),
('"ART LIGHTS,FUNK MONKEY",5100', 'customer-13941/invoice-536617/line-3281'),
('HOME BUILDING BLOCK WORD,1785', 'customer-13047/invoice-536367/line-19'),
('"FANCY FONT BIRTHDAY CARD, ",504', 'customer-15601/invoice-536623/line-3345'),
('LOVE BUILDING BLOCK WORD,1785', 'customer-13047/invoice-536367/line-20'),
('"HOOK, 1 HANGER ,MAGIC GARDEN",2040', 'customer-15601/invoice-536623/line-3372'),
('RECIPE BOX WITH METAL HEART,3180', 'customer-13047/invoice-536367/line-21'),
('"CAKESTAND, 3 TIER, LOVEHEART",1990', 'customer-15658/invoice-536627/line-3416'),
('DOORMAT NEW ENGLAND,3180', 'customer-13047/invoice-536367/line-22'),
('"FEATHER PEN,HOT PINK",1020', 'customer-16244/invoice-536638/line-3605'),
('JAM MAKING SET WITH JARS,2550', 'customer-13047/invoice-536368/line-23'),
('"SET 3 RETROSPOT TEA,COFFEE,SUGAR",1980', 'customer-16244/invoice-536638/line-3621'),
('RED COAT RACK PARIS FASHION,1485', 'customer-13047/invoice-536368/line-24'),
('"DECORATION HEN ON NEST, HANGING",1980', 'customer-16244/invoice-536638/line-3654'),
('YELLOW COAT RACK PARIS FASHION,1485', 'customer-13047/invoice-536368/line-25'),
('"BLACK TEA,COFFEE,SUGAR JARS",1270', 'customer-14180/invoice-536739/line-3931'),
('BLUE COAT RACK PARIS FASHION,1485', 'customer-13047/invoice-536368/line-26'),
('"KEY FOB , GARAGE DESIGN",260', 'customer-14449/invoice-536754/line-4213'),
('BATH BUILDING BLOCK WORD,1785', 'customer-13047/invoice-536369/line-27'),
('"KEY FOB , FRONT  DOOR ",260', 'customer-14449/invoice-536754/line-4217'),
('ALARM CLOCK BAKELIKE PINK,9000', 'customer-12583/invoice-536370/line-28'),
('"KEY FOB , BACK DOOR ",260', 'customer-14449/invoice-536754/line-4218'),
('ALARM CLOCK BAKELIKE RED ,9000', 'customer-12583/invoice-536370/line-29'),
('"WRAP, BILLBOARD FONTS DESIGN",1050', 'customer-16186/invoice-536762/line-4333'),
('ALARM CLOCK BAKELIKE GREEN,4500', 'customer-12583/invoice-536370/line-30'),
('"ELEPHANT, BIRTHDAY CARD, ",1728', 'customer-15061/invoice-536783/line-4452'),
('PANDA AND BUNNIES STICKER SHEET,1020', 'customer-12583/invoice-536370/line-31');
commit;
