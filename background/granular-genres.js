/**
 * Granular watch-history genre presets (title / URL text matching only).
 * Order: more specific phrases should appear before broader buckets so ties favor specificity.
 * Loaded by service-worker via importScripts.
 */
globalThis.GRANULAR_GENRE_PRESETS = [
  { label: "Liberal / progressive politics", keywords: ["liberal", "progressive", "democrat", "democratic party", "aoc", "bernie", "msnbc", "cnn politics", "left wing", "blue state", "biden harris", "social justice politics"] },
  { label: "Conservative / right politics", keywords: ["conservative", "republican", "gop", "fox news", "right wing", "maga", "trump rally", "daily wire", "prager", "turning point", "red state", "tucker", "hannity", "ben shapiro politics"] },
  { label: "Libertarian & civil-liberties politics", keywords: ["libertarian", "ron paul", "reason tv", "cato institute", "second amendment debate", "taxation is theft"] },
  { label: "Elections & campaigns", keywords: ["election", "campaign", "primary debate", "polling", "electoral", "vote 202", "ballot", "swing state", "get out the vote"] },
  { label: "International affairs", keywords: ["foreign policy", "nato", "un security", "geopolitics", "middle east news", "china taiwan", "ukraine war", "israel palestine", "eu parliament"] },
  { label: "US law & courts", keywords: ["supreme court", "scotus", "congress hearing", "senate floor", "house judiciary", "constitutional law", "doj", "fbi hearing"] },
  { label: "Political commentary (general)", keywords: ["political commentary", "politics podcast", "news politics", "political analysis", "current events politics"] },

  { label: "PC gaming", keywords: ["pc gaming", "steam game", "rtx", "pc build gaming", "ultrawide gaming", "keyboard and mouse", "valorant pc", "counter strike", "dota", "league of legends pc"] },
  { label: "Console gaming", keywords: ["ps5", "playstation", "xbox series", "xbox one", "switch game", "nintendo direct", "console exclusive", "dualsense"] },
  { label: "Gaming (general)", keywords: ["gameplay", "let's play", "walkthrough", "no commentary gameplay", "gaming news", "videogame", "video game", "gamer", "esports"] },
  { label: "Speedrunning & challenges", keywords: ["speedrun", "any%", "rta", "challenge run", "world record run"] },
  { label: "Retro gaming", keywords: ["retro gaming", "emulator", "snes", "n64", "gamecube", "arcade cabinet", "mame", "crt gaming"] },

  { label: "Drones & FPV", keywords: ["fpv drone", "fpv flight", "dji mini", "dji mavic", "racing drone", "whoop drone", "drone build", "betaflight", "iflight", "cinewhoop", "drone cinematic"] },
  { label: "RC vehicles (non-FPV)", keywords: ["rc car", "rc truck", "traxxas", "tamiya rc", "rc plane", "rc boat", "radio control hobby"] },
  { label: "Computer builds & upgrades", keywords: ["pc build", "gaming pc build", "newegg", "pc part picker", "gpu upgrade", "cpu upgrade", "custom loop", "liquid cooler", "itx build", "sffpc"] },
  { label: "Linux & open source", keywords: ["linux tutorial", "arch linux", "ubuntu", "fedora", "gentoo", "nixos", "bash script", "terminal workflow", "open source"] },
  { label: "Programming & software dev", keywords: ["programming tutorial", "leetcode", "system design", "javascript tutorial", "typescript", "rust lang", "go golang", "python tutorial", "api design", "docker kubernetes"] },
  { label: "Cybersecurity", keywords: ["cybersecurity", "penetration test", "ctf writeup", "malware analysis", "reverse engineering", "oscp", "burp suite"] },
  { label: "AI & machine learning", keywords: ["machine learning", "neural network", "llm", "chatgpt", "pytorch", "tensorflow", "hugging face", "ai news"] },
  { label: "Smartphones & gadgets", keywords: ["iphone review", "samsung galaxy", "pixel review", "smartphone review", "android review", "gadget review"] },

  { label: "Cars & automotive", keywords: ["car review", "automotive", "track day", "car detailing", "engine swap", "turbo build", "jdm", "mustang", "bmw m", "porsche", "tesla model", "ev review"] },
  { label: "Motorcycles", keywords: ["motorcycle review", "motovlog", "sportbike", "harley", "ducati", "yamaha r1", "kawasaki ninja"] },
  { label: "Bowling", keywords: ["bowling", "ten pin", "pba bowling", "bowling ball review", "lane play"] },
  { label: "Poker & card games", keywords: ["poker vlog", "wsop", "texas holdem", "pokerstars", "live poker", "blackjack strategy", "card counting"] },
  { label: "Chess & mind sports", keywords: ["chess", "lichess", "chesscom", "grandmaster", "opening theory", "endgame study"] },
  { label: "Billiards & pool", keywords: ["pool trick shot", "snooker", "9 ball", "billiards"] },

  { label: "Fitness & strength", keywords: ["workout", "hypertrophy", "powerlifting", "deadlift", "bench press", "squat form", "gym vlog", "bodybuilding"] },
  { label: "Running & endurance", keywords: ["marathon training", "5k training", "ultra marathon", "running form", "vo2 max"] },
  { label: "Yoga & mobility", keywords: ["yoga flow", "vinyasa", "mobility routine", "stretching routine", "pilates"] },

  { label: "Cooking & recipes", keywords: ["recipe", "cooking tutorial", "chef tips", "sous vide", "baking recipe", "meal prep"] },
  { label: "BBQ & smoking meat", keywords: ["bbq", "smoked brisket", "low and slow", "pellet grill", "weber smoker", "ribs recipe"] },

  { label: "Film & cinema", keywords: ["movie review", "film analysis", "cinema", "oscars", "director commentary", "ending explained"] },
  { label: "TV series & streaming", keywords: ["season finale", "episode recap", "series review", "netflix series", "hbo series"] },
  { label: "Anime & manga", keywords: ["anime episode", "manga review", "shonen", "isekai", "weeb", "otaku", "crunchyroll"] },

  { label: "Music production", keywords: ["ableton", "fl studio", "logic pro", "mixing mastering", "sound design", "beat making"] },
  { label: "Electronic music culture", keywords: ["edm", "techno set", "house music mix", "festival set", "dj set"] },
  { label: "Hip-hop & rap", keywords: ["rap cypher", "hip hop", "freestyle rap", "album reaction rap"] },
  { label: "Rock & metal", keywords: ["metal cover", "guitar riff", "rock band live", "metalcore", "djent"] },

  { label: "Science & space", keywords: ["nasa", "spacex", "rocket launch", "astronomy", "physics explained", "chemistry lab", "biology lecture"] },
  { label: "Nature & wildlife", keywords: ["wildlife documentary", "national geographic", "ocean animals", "safari", "birding"] },

  { label: "DIY & home repair", keywords: ["diy home", "drywall repair", "plumbing fix", "electrical outlet", "home improvement"] },
  { label: "Woodworking & carpentry", keywords: ["woodworking", "joinery", "table saw", "router table", "carpentry"] },
  { label: "3D printing", keywords: ["3d print", "filament", "prusament", "bambu lab", "slicer settings"] },

  { label: "Photography & video gear", keywords: ["camera review", "lens review", "sony alpha", "canon r", "nikon z", "cinematography tutorial"] },
  { label: "Streaming & YouTube creator tips", keywords: ["obs studio", "stream setup", "youtube growth", "thumbnail tutorial", "content strategy"] },

  { label: "Personal finance & investing", keywords: ["investing", "stock market", "index fund", "real estate investing", "401k", "roth ira", "financial independence"] },
  { label: "Crypto & blockchain", keywords: ["bitcoin", "ethereum", "defi", "nft", "crypto news", "blockchain"] },

  { label: "Travel vlogs", keywords: ["travel vlog", "city tour", "backpacking", "solo travel", "digital nomad"] },
  { label: "Flight & aviation fan", keywords: ["flight review", "airline review", "cockpit", "planespotting", "avgeek"] },

  { label: "ASMR & relaxation", keywords: ["asmr", "tingles", "sleep sounds", "relaxing triggers"] },
  { label: "True crime & legal stories", keywords: ["true crime", "court case", "murder trial", "unsolved mystery"] },
  { label: "Comedy & sketches", keywords: ["comedy sketch", "standup comedy", "funny compilation", "parody"] },

  { label: "Religion & theology", keywords: ["sermon", "bible study", "quran", "theology", "faith talk"] },
  { label: "Self-help & productivity", keywords: ["productivity system", "habit building", "stoicism", "motivation speech", "deep work"] },

  { label: "Pets & animals (cute)", keywords: ["cute puppy", "kitten", "dog training", "cat behavior", "pet care"] },
  { label: "Gardening", keywords: ["gardening tips", "vegetable garden", "hydroponic", "compost", "raised bed"] },

  { label: "Education & tutorials (general)", keywords: ["explained simply", "crash course", "how does", "tutorial for beginners", "lecture recording"] },
  { label: "History documentaries", keywords: ["history documentary", "ancient rome", "world war", "cold war", "historical documentary"] },

  { label: "Breaking news (general)", keywords: ["breaking news", "live news", "news alert", "headlines today"] },
  { label: "Sports highlights", keywords: ["highlights", "nba highlights", "nfl highlights", "soccer highlights", "ufc highlights", "full fight highlights"] },
  { label: "Golf", keywords: ["golf swing", "pga tour", "golf tips", "masters tournament"] },
  { label: "Fishing", keywords: ["bass fishing", "fly fishing", "fishing vlog", "catch and cook"] },

  { label: "Board games & tabletop", keywords: ["board game", "tabletop rpg", "dnd campaign", "warhammer", "miniature painting"] },
  { label: "Magic & cardistry", keywords: ["magic trick tutorial", "cardistry", "sleight of hand"] },

  { label: "Beauty & skincare", keywords: ["makeup tutorial", "skincare routine", "grwm"] },
  { label: "Fashion & sneakers", keywords: ["sneaker review", "outfit check", "streetwear", "fashion haul"] },

  { label: "General & mixed", keywords: ["vlog", "day in the life", "q&a", "storytime", "update video"] },
];
