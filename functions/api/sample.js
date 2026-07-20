let env;
// Summy Garden Studio — AI thumbnails for the gallery scenes AND the studio option pickers.
// Each image is generated ONCE via Gemini and cached in Netlify Blobs, then served forever.
const MODEL = "gemini-2.5-flash-image";
const API = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const SUBJECTS = ["a professional businesswoman","a professional businessman","a young professional woman","a young professional man","a confident senior female executive","a confident senior male executive"];

// scene metadata is injected at build; keep a small fallback so the function is standalone
const META = [{"n": "Morning Boardroom", "c": "Office & Boardroom", "d": "Dawn light through glass walls of a quiet boardroom."}, {"n": "Executive Corner Office", "c": "Office & Boardroom", "d": "Warm window light over a softly blurred corner office."}, {"n": "Glass Meeting Room", "c": "Office & Boardroom", "d": "Cool frosted glass and steel, precise and corporate."}, {"n": "Open-Plan Daylight", "c": "Office & Boardroom", "d": "Bright open workspace with soft depth of field."}, {"n": "Dusk Boardroom", "c": "Office & Boardroom", "d": "Blue-hour glass office with city glow beyond."}, {"n": "Mahogany Suite", "c": "Office & Boardroom", "d": "Wood-panelled warmth, classic senior-partner presence."}, {"n": "Reception Lounge", "c": "Office & Boardroom", "d": "Bright marble lobby with a premium first impression."}, {"n": "Skyline Meeting Deck", "c": "Office & Boardroom", "d": "High-floor room with a hazy skyline through glass."}, {"n": "Creative Studio Office", "c": "Office & Boardroom", "d": "Soft neutral studio office with plants and daylight."}, {"n": "Navy Panel Office", "c": "Office & Boardroom", "d": "Deep navy panelling with a confident key light."}, {"n": "Business Park Morning", "c": "Business Park", "d": "Fresh morning light over landscaped office towers."}, {"n": "Campus at Noon", "c": "Business Park", "d": "Bright glass campus blocks with clipped green rows."}, {"n": "Golden Hour Park", "c": "Business Park", "d": "Amber sun across the office park facades."}, {"n": "Innovation District", "c": "Business Park", "d": "Cool blue towers, young trees, startup energy."}, {"n": "Riverside Offices", "c": "Business Park", "d": "Soft water-cooled light over the business quarter."}, {"n": "Dusk Business Park", "c": "Business Park", "d": "Warm windows lighting up at blue hour."}, {"n": "Rainy-Day Campus", "c": "Business Park", "d": "Muted grey-green calm after summer rain."}, {"n": "Tech Quarter", "c": "Business Park", "d": "Steel-and-glass blocks with a cyan reflection."}, {"n": "Garden Atrium Walk", "c": "Business Park", "d": "Planted walkway between low glass pavilions."}, {"n": "Harbourfront Offices", "c": "Business Park", "d": "Sea-light towers on the waterfront boulevard."}, {"n": "Downtown Morning", "c": "City Street", "d": "Soft-focus main street in early light."}, {"n": "Golden Hour Avenue", "c": "City Street", "d": "Warm evening sun down the avenue."}, {"n": "Blue Hour Crossing", "c": "City Street", "d": "Blue dusk with warm windows and lamp glow."}, {"n": "Old Town Lane", "c": "City Street", "d": "Heritage facades in gentle stone tones."}, {"n": "Neon District", "c": "City Street", "d": "Muted neon bokeh, urban creative energy."}, {"n": "Financial Mile", "c": "City Street", "d": "Steel canyon of banks and towers, direct and sharp."}, {"n": "Rainy Reflections", "c": "City Street", "d": "Wet asphalt reflecting soft city light."}, {"n": "Market Street", "c": "City Street", "d": "Lively low-rise street with awning colours."}, {"n": "Tram Line Morning", "c": "City Street", "d": "Hong Kong-style tram street waking up."}, {"n": "Bridge Approach", "c": "City Street", "d": "First light on the bridge into the city."}, {"n": "Summer Garden", "c": "Park & Garden", "d": "Full-bloom greens with flower dots — the studio signature scene."}, {"n": "Rose Garden", "c": "Park & Garden", "d": "Soft pink-touched foliage in warm light."}, {"n": "Morning Park Path", "c": "Park & Garden", "d": "Dappled path light through fresh leaves."}, {"n": "Botanic Conservatory", "c": "Park & Garden", "d": "Lush deep greens with glasshouse light."}, {"n": "Autumn Arboretum", "c": "Park & Garden", "d": "Amber and rust foliage, seasoned and warm."}, {"n": "Lavender Walk", "c": "Park & Garden", "d": "Purple-touched borders in soft evening sun."}, {"n": "Meadow Light", "c": "Park & Garden", "d": "Open meadow greens under a big bright sky."}, {"n": "Zen Courtyard", "c": "Park & Garden", "d": "Still, minimal greens with quiet balance."}, {"n": "Rain-Fresh Green", "c": "Park & Garden", "d": "Post-rain leaves with a cool clean sheen."}, {"n": "Evening Garden Party", "c": "Park & Garden", "d": "Warm string-light glow over dusk foliage."}, {"n": "Lake Sunrise", "c": "Lakeside", "d": "First gold over still summer water."}, {"n": "Blue Noon Lake", "c": "Lakeside", "d": "Bright blue water under a clear sky."}, {"n": "Misty Morning Water", "c": "Lakeside", "d": "Soft grey-blue mist over the shoreline."}, {"n": "Golden Hour Pier", "c": "Lakeside", "d": "Warm low sun stretching across the water."}, {"n": "Alpine Lake", "c": "Lakeside", "d": "Cool mountain blues, steady and far-sighted."}, {"n": "Harbour View", "c": "Lakeside", "d": "Sea-light blues with a bright horizon."}, {"n": "Dusk Reflection", "c": "Lakeside", "d": "Violet-blue dusk mirrored on calm water."}, {"n": "Reed Bank Morning", "c": "Lakeside", "d": "Gentle green-blue shore with soft reeds."}, {"n": "Summer Regatta", "c": "Lakeside", "d": "Crisp regatta blues with white light."}, {"n": "Moonlit Water", "c": "Lakeside", "d": "Deep night blues with a silver moon path."}, {"n": "Centre Court Blue", "c": "Sports & Tennis", "d": "Classic hard-court blue with crisp white lines."}, {"n": "Grass Court Club", "c": "Sports & Tennis", "d": "Lawn-court green, heritage and polish."}, {"n": "Clay Court Session", "c": "Sports & Tennis", "d": "Terracotta clay with warm summer light."}, {"n": "Morning Practice", "c": "Sports & Tennis", "d": "Cool early-light court before the heat."}, {"n": "Padel Club", "c": "Sports & Tennis", "d": "Modern teal court, social and fast-growing."}, {"n": "Sunset Match", "c": "Sports & Tennis", "d": "Golden sky over a dusk-lit court."}, {"n": "Indoor Arena", "c": "Sports & Tennis", "d": "Even indoor light on a pro surface."}, {"n": "Country Club Green", "c": "Sports & Tennis", "d": "Deep green court framed by hedges."}, {"n": "Beach Tennis", "c": "Sports & Tennis", "d": "Sandy court with holiday brightness."}, {"n": "Championship Purple", "c": "Sports & Tennis", "d": "Tour-style purple court, bold and pro."}, {"n": "Sunlit Café Corner", "c": "Café & Canteen", "d": "Warm café wall with pendant glow and window light."}, {"n": "Modern Staff Canteen", "c": "Café & Canteen", "d": "Clean bright canteen with long tables."}, {"n": "Espresso Bar", "c": "Café & Canteen", "d": "Deep coffee tones with warm brass light."}, {"n": "Garden Terrace Café", "c": "Café & Canteen", "d": "Airy terrace greens beside the counter."}, {"n": "Harbour Café", "c": "Café & Canteen", "d": "Sea-light café with big open windows."}, {"n": "Bookshop Coffee Nook", "c": "Café & Canteen", "d": "Cosy shelves-and-coffee warmth."}, {"n": "Brunch House", "c": "Café & Canteen", "d": "Blush-and-cream weekend brightness."}, {"n": "Night Café", "c": "Café & Canteen", "d": "Low amber light for after-hours character."}, {"n": "Juice & Salad Bar", "c": "Café & Canteen", "d": "Fresh green-and-citrus counter energy."}, {"n": "Tea House", "c": "Café & Canteen", "d": "Calm jade-and-wood tea room serenity."}, {"n": "University Main Hall", "c": "Campus & Library", "d": "Classical columns in honey stone."}, {"n": "Graduation Lawn", "c": "Campus & Library", "d": "Bright quad ready for the big day."}, {"n": "Heritage Library Front", "c": "Campus & Library", "d": "Stately facade in warm afternoon light."}, {"n": "Modern Faculty", "c": "Campus & Library", "d": "Concrete-and-glass faculty building, crisp lines."}, {"n": "Autumn Campus", "c": "Campus & Library", "d": "Amber trees framing the old hall."}, {"n": "Museum Steps", "c": "Campus & Library", "d": "Grand gallery entrance, cultured and calm."}, {"n": "Observatory Hill", "c": "Campus & Library", "d": "Dusk blues over the science dome."}, {"n": "Law School Portico", "c": "Campus & Library", "d": "Dark stone authority with measured light."}, {"n": "Boarding School Green", "c": "Campus & Library", "d": "Collegiate red-brick warmth on the green."}, {"n": "Exam Hall Calm", "c": "Campus & Library", "d": "Quiet neutral stone, focused and steady."}, {"n": "Classic Studio Grey", "c": "Studio Classics", "d": "Timeless neutral sweep — the safest choice anywhere."}, {"n": "Pearl White", "c": "Studio Classics", "d": "Clean bright white with gentle falloff."}, {"n": "Charcoal Editorial", "c": "Studio Classics", "d": "Matte charcoal spotlight, magazine-grade."}, {"n": "Warm Stone", "c": "Studio Classics", "d": "Neutral stone with a friendly warm cast."}, {"n": "Deep Navy Studio", "c": "Studio Classics", "d": "Rich navy vignette with quiet gravitas."}, {"n": "Soft Beige Portrait", "c": "Studio Classics", "d": "Gentle cream flattering to all skin tones."}, {"n": "Sage Studio", "c": "Studio Classics", "d": "Muted sage green, balanced and natural."}, {"n": "Powder Blue Studio", "c": "Studio Classics", "d": "Calm powder blue diffusion, trustworthy."}, {"n": "Blush Studio", "c": "Studio Classics", "d": "Soft rose warmth, personable and polished."}, {"n": "Jet Black Studio", "c": "Studio Classics", "d": "True black with a controlled rim glow."}, {"n": "Summy Signature", "c": "Signature Gradients", "d": "The Summy Garden Studio brand gradient — sky to leaf."}, {"n": "Sky to Sun", "c": "Signature Gradients", "d": "Morning blue melting into sunshine gold."}, {"n": "Ocean Noon", "c": "Signature Gradients", "d": "Clean two-stop sea blues, bright and technical."}, {"n": "Garden Dawn", "c": "Signature Gradients", "d": "Leaf green into soft dawn cream."}, {"n": "Sunset Petal", "c": "Signature Gradients", "d": "Gold into petal pink, warm achievement energy."}, {"n": "Deep Sea Slate", "c": "Signature Gradients", "d": "Slate-teal depths, serious and unhurried."}, {"n": "Champagne Fade", "c": "Signature Gradients", "d": "Champagne into bronze, celebratory and refined."}, {"n": "Midsummer Night", "c": "Signature Gradients", "d": "Deep blue-green dusk with firefly glow."}, {"n": "Lemonade", "c": "Signature Gradients", "d": "Zesty citrus freshness for early careers."}, {"n": "Sky Ceiling", "c": "Signature Gradients", "d": "Open blue-sky wash — limitless and upward."}];

// ---- studio option prompt sets (generic model, photoreal) ----
const OPT = {
  style: [
    ["Formal","formal corporate headshot photograph of a person in business attire"],
    ["Studio","studio-lit portrait headshot photograph of a person, even key light"],
    ["Corporate","corporate headshot photograph of a person, neutral balanced colour"],
    ["Office","bright professional workday headshot photograph of a person"],
    ["Casual","relaxed smart-casual headshot photograph of a person, warm light"],
    ["Natural","natural headshot photograph of a person in soft daylight"],
    ["Creative","creative colourful headshot photograph of a person, artistic lighting"],
    ["Fashion","fashion editorial headshot photograph of a stylish person"],
    ["Street","candid urban-style headshot photograph of a person, cool grade"],
    ["Luxury","luxury premium headshot photograph of a person, rich elegant tones"],
    ["Editorial","editorial magazine headshot photograph of a person, high contrast"],
    ["Vintage","warm vintage film-style headshot photograph of a person"],
    ["Black & white","fine-art black and white monochrome headshot photograph of a person"],
    ["Soft glow","soft-focus dreamy headshot photograph of a person with gentle glow"],
    ["High key","bright airy high-key headshot photograph of a person, minimal shadows"],
    ["Low key","dramatic low-key headshot photograph of a person, deep shadows"],
    ["Golden warm","warm golden-toned headshot photograph of a person, sunlit"],
    ["Cool crisp","cool-toned crisp modern headshot photograph of a person"],
    ["Cinematic","cinematic film-graded headshot photograph of a person, teal and amber"],
    ["Executive","authoritative executive headshot photograph of a senior leader"],
    ["Approachable","warm friendly approachable headshot photograph of a person"],
    ["Tech","clean modern minimal tech headshot photograph of a person"],
    ["Academic","scholarly academic portrait photograph of a person, restrained tone"],
    ["Bold","bold punchy saturated headshot photograph of a person, striking"],
  ],
  outfit: [
    ["Navy suit","close-up product photograph of a tailored navy business suit with a white shirt worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Charcoal suit","close-up product photograph of a charcoal grey business suit worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Light blazer","close-up product photograph of a light beige smart blazer over an open-collar shirt worn on a torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Black turtleneck","close-up product photograph of a refined black turtleneck worn on a torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["White shirt","close-up product photograph of a crisp white collared shirt worn on a torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Blouse","close-up product photograph of an elegant professional blouse worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Sportswear","close-up product photograph of a clean modern athletic performance polo worn on a torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Uniform","close-up product photograph of a smart pressed professional service uniform worn on a torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Black suit","close-up product photograph of a sharp black business suit with a white shirt worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Light grey suit","close-up product photograph of a light grey business suit worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Pinstripe suit","close-up product photograph of a classic navy pinstripe business suit worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Three-piece suit","close-up product photograph of a three-piece suit with a matching waistcoat worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Women's trouser suit","close-up product photograph of a tailored women's trouser suit jacket with a soft blouse underneath, clearly feminine cut worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio","w2"],
    ["Women's skirt suit","close-up product photograph of a tailored women's skirt suit with a fitted feminine jacket and shell top worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio","w2"],
    ["Linen blazer","close-up product photograph of a relaxed natural linen summer blazer worn on a torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Tweed jacket","close-up product photograph of a textured brown tweed jacket worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Blazer over tee","close-up product photograph of a smart dark blazer worn over a plain fitted tee worn on a torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Blue shirt","close-up product photograph of a pressed light blue collared shirt worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Striped shirt","close-up product photograph of a fine blue-striped business shirt worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Open-collar shirt","close-up product photograph of a relaxed open-collar shirt with no tie worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Shirt & tie","close-up product photograph of a pressed white shirt with a well-knotted navy tie worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Tuxedo","close-up product photograph of a black tuxedo with a black bow tie worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Silk blouse","close-up product photograph of a flowing ivory silk blouse worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Knit sweater","close-up product photograph of a fine merino knit sweater in soft grey worn on a torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Cardigan","close-up product photograph of a smart fitted cardigan over a collared shirt worn on a torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Sheath dress","close-up product photograph of an elegant tailored sheath dress, upper bodice worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Wrap dress","close-up product photograph of a professional wrap dress, upper bodice worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Polo shirt","close-up product photograph of a clean fitted navy polo shirt worn on a torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Hijab & blazer","close-up product photograph of a smart blazer with a neatly draped hijab headscarf over the shoulders worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["White coat","close-up product photograph of a doctor's white medical coat over a collared shirt worn on a torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Medical scrubs","close-up product photograph of clean teal medical scrubs worn on a torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Chef's whites","close-up product photograph of a chef's double-breasted white jacket worn on a torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Pilot uniform","close-up product photograph of an airline pilot uniform jacket with shoulder epaulettes worn on a torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Hi-vis workwear","close-up product photograph of a hi-visibility yellow safety vest over a work shirt worn on a torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Academic gown","close-up product photograph of an academic graduation gown with a coloured hood worn on a torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Cheongsam","close-up product photograph of an elegant traditional silk cheongsam, upper bodice worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Blazer & camisole","close-up product photograph of a tailored blazer over a silk camisole worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Longline blazer","close-up product photograph of a longline tailored blazer in soft taupe worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Bouclé jacket","close-up product photograph of a classic cream boucle tweed jacket with braided trim worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Women's tuxedo","close-up product photograph of a women's tuxedo jacket with satin lapels worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Puff-sleeve blouse","close-up product photograph of a soft puff-sleeve blouse in ivory worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Ruffle blouse","close-up product photograph of a ruffle-front blouse in blush worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Knit twinset","close-up product photograph of a fine knit twinset in soft grey worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Shirt dress","close-up product photograph of a tailored shirt dress, upper bodice worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Midi dress","close-up product photograph of an elegant professional midi dress, upper bodice worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Kimono jacket","close-up product photograph of a draped kimono-style jacket in deep teal worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Sari","close-up product photograph of an elegant traditional silk sari draped over the shoulder worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Abaya","close-up product photograph of an elegant tailored black abaya with subtle embroidery worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Cardigan & scarf","close-up product photograph of a fine cardigan with a patterned silk scarf at the neck worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Turtleneck & blazer","close-up product photograph of a fitted turtleneck under a tailored blazer, feminine cut worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Peplum jacket","close-up product photograph of a structured peplum jacket in navy worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Satin blouse","close-up product photograph of a lustrous satin blouse in champagne worn on a woman's dress form, clearly feminine cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Double-breasted suit","close-up product photograph of a double-breasted navy business suit worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Brown suit","close-up product photograph of a warm brown business suit with a light shirt worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Blue suit","close-up product photograph of a bright royal blue business suit worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Waistcoat & shirt","close-up product photograph of a grey waistcoat over a pressed white shirt worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Suit & pocket square","close-up product photograph of a navy suit with a folded white pocket square worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Knit tie & shirt","close-up product photograph of an oxford shirt with a textured knit tie worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Denim shirt","close-up product photograph of a smart washed denim shirt worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Bomber jacket","close-up product photograph of a refined navy bomber jacket worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Field jacket","close-up product photograph of a smart olive field jacket worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Sweater vest","close-up product photograph of a knitted sweater vest over a collared shirt worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Henley shirt","close-up product photograph of a fitted charcoal henley shirt worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Mandarin collar suit","close-up product photograph of a mandarin-collar suit jacket in dark navy worn on a man's torso, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Women's navy suit","close-up product photograph of a tailored women's navy business suit jacket with a white shell top worn on a woman's dress form, clearly feminine tailored cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Women's charcoal suit","close-up product photograph of a tailored women's charcoal grey business suit jacket worn on a woman's dress form, clearly feminine tailored cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Women's black suit","close-up product photograph of a sharp women's black business suit jacket with a silk shell worn on a woman's dress form, clearly feminine tailored cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Women's grey suit","close-up product photograph of a tailored women's light grey business suit jacket worn on a woman's dress form, clearly feminine tailored cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Women's pinstripe suit","close-up product photograph of a women's navy pinstripe business suit jacket worn on a woman's dress form, clearly feminine tailored cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
    ["Women's double-breasted suit","close-up product photograph of a women's double-breasted business suit jacket worn on a woman's dress form, clearly feminine tailored cut, cropped from shoulders to waist, NO head and NO face visible, clothing detail, clean studio"],
  ],
  pose: [
    ["Straight on","professional headshot photograph of a person facing camera straight on"],
    ["Left facing","professional headshot photograph of a person with body turned to their left, face to camera"],
    ["Right facing","professional headshot photograph of a person with body turned to their right, face to camera"],
    ["Close-up","tight close-up professional portrait photograph of a person's face"],
    ["Half body","half-body professional portrait photograph of a person from the waist up"],
    ["Chin up","professional headshot photograph of a person with chin slightly raised, confident"],
    ["Three-quarter","three-quarter turned professional portrait photograph of a person"],
    ["Slight angle","professional headshot photograph of a person at a slight body angle"],
    ["Over shoulder","professional portrait photograph of a person looking back over one shoulder"],
    ["Arms crossed","professional half-body portrait photograph of a person with arms crossed"],
    ["Hands in pockets","professional half-body portrait photograph of a person with hands in pockets"],
    ["Seated","professional portrait photograph of a person seated upright and composed"],
    ["Leaning","professional half-body portrait photograph of a person leaning casually"],
    ["Head tilt","professional headshot photograph of a person with a gentle head tilt"],
    ["Relaxed","professional headshot photograph of a person with relaxed easy posture"],
    ["Standing tall","professional half-body portrait photograph of a person standing tall, squared shoulders"],
    ["Hand to chin","professional portrait photograph of a person with a hand thoughtfully near the chin"],
    ["Looking away","candid professional portrait photograph of a person looking slightly away from camera"],
  ],
  osp: [
    ["Auto","close-up photograph of a tidy rail of assorted tailored professional jackets, blazers and shirts in a boutique, garments only, absolutely no people, no head, no face, clean bright studio"],
    ["Original","close-up product photograph of a plain simple everyday casual top worn on a torso, cropped from shoulders to waist, NO head and NO face visible, soft neutral colour, clean studio"],
  ],
  expr: [
    ["Natural smile","professional headshot photograph of a person with a natural gentle smile, neutral studio"],
    ["Big smile","professional headshot photograph of a person with a big happy smile showing teeth, neutral studio"],
    ["Confident","professional headshot photograph of a person with a confident composed expression, neutral studio"],
    ["Friendly","professional headshot photograph of a person with a warm friendly expression, neutral studio"],
    ["Serious","professional headshot photograph of a person with a serious strict expression, neutral studio"],
    ["Neutral","professional headshot photograph of a person with a relaxed neutral expression, neutral studio"],
  ],
};

function buildPrompt(kind, i) {
  if (kind === "p") { const m = META[i]; return `Professional corporate headshot photograph of ${SUBJECTS[i % 6]}, ${m.n.toLowerCase()} setting (${m.c.toLowerCase()}), ${m.d.toLowerCase().replace(/\./g,"")}, photorealistic, 85mm portrait lens, shallow depth of field, looking at camera, head and shoulders, professional attire.`; }
  if (kind === "b") { const m = META[i]; return `Empty professional photography backdrop: ${m.n.toLowerCase()} (${m.c.toLowerCase()}), ${m.d.toLowerCase().replace(/\./g,"")}, absolutely no people, photorealistic, soft bokeh, shallow depth of field.`; }
  const set = OPT[kind]; if (!set || !set[i]) return null;
  return set[i][1] + ", photorealistic, high quality, soft professional lighting.";
}

const handler = async (req) => {
  const url = new URL(req.url);
  const kind = ["p","b","style","outfit","pose","expr","osp"].includes(url.searchParams.get("kind")) ? url.searchParams.get("kind") : "p";
  const maxI = kind === "p" || kind === "b" ? META.length : (OPT[kind] ? OPT[kind].length : 1);
  const i = Math.min(Math.max(parseInt(url.searchParams.get("i") || "0", 10) || 0, 0), maxI - 1);
  const ver = (kind !== "p" && kind !== "b" && OPT[kind] && OPT[kind][i] && OPT[kind][i][2]) ? "-" + OPT[kind][i][2] : "";
  const key = `${kind}-${i}${ver}`;

  let buf = (env.SCENE_CACHE ? await env.SCENE_CACHE.get(key, { type: "arrayBuffer" }) : null);

  // Migration bridge: the thumbnails were generated once and cached on the old
  // Netlify host. On a cold Cloudflare KV miss, pull the already-generated image
  // from Netlify (no Gemini usage) and store it in KV so it persists going forward.
  if (!buf) {
    try {
      const nres = await fetch(`https://summy-garden-studio.netlify.app/.netlify/functions/sample?kind=${encodeURIComponent(kind)}&i=${i}`);
      const ct = nres.headers.get("content-type") || "";
      if (nres.ok && ct.startsWith("image/")) {
        const ab = await nres.arrayBuffer();
        if (ab && ab.byteLength > 0) {
          if (env.SCENE_CACHE) await env.SCENE_CACHE.put(key, ab);
          buf = ab;
        }
      }
    } catch (e) { /* fall through to Gemini */ }
  }

  if (!buf) {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) return new Response("not configured", { status: 501 });
    const prompt = buildPrompt(kind, i);
    if (!prompt) return new Response("bad kind/index", { status: 400 });
    const res = await fetch(`${API}?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { imageConfig: { aspectRatio: "3:4" } } }),
    });
    if (!res.ok) { const t = await res.text(); const q = res.status === 429; return new Response(q ? "image quota reached" : "generation failed", { status: q ? 429 : 502 }); }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const img = parts.find((p) => p.inlineData || p.inline_data);
    if (!img) return new Response("no image", { status: 502 });
    const d = img.inlineData || img.inline_data;
    const bin = Uint8Array.from(atob(d.data), (c) => c.charCodeAt(0));
    if (env.SCENE_CACHE) await env.SCENE_CACHE.put(key, bin.buffer);
    buf = bin.buffer;
  }
  return new Response(buf, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" } });
};

export async function onRequest(context){ env = context.env; return handler(context.request); }
