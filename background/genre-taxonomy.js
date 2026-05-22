/**
 * Fixed broad genre buckets for library-based category rebuild (~25).
 * Each entry: display label + keywords for local matching (titles/channels/tags text).
 * Loaded by service-worker via importScripts.
 */
globalThis.TUBESTACK_BROAD_GENRES = [
  { label: "Gaming & esports", keywords: ["gaming", "gameplay", "gamer", "esports", "speedrun", "walkthrough", "lets play", "twitch", "valorant", "minecraft", "fortnite", "roblox", "steam"] },
  { label: "Tech & computing", keywords: ["tech", "software", "programming", "developer", "linux", "windows", "review laptop", "gpu", "cpu", "apple silicon", "android", "iphone review"] },
  { label: "Science & engineering", keywords: ["science", "physics", "chemistry", "biology", "engineering", "nasa", "spacex", "experiment", "lab"] },
  { label: "News & politics", keywords: ["news", "breaking", "politics", "election", "government", "journalism", "debate", "white house", "parliament"] },
  { label: "Music & audio", keywords: ["music", "album", "song", "concert", "mix", "dj", "guitar", "piano", "remix", "band"] },
  { label: "Film & TV", keywords: ["movie", "film", "tv show", "trailer", "recap", "cinema", "series", "netflix", "hbo", "episode"] },
  { label: "Education & how-to", keywords: ["tutorial", "explained", "course", "lecture", "learn", "how to", "tips", "guide", "lesson"] },
  { label: "DIY & maker", keywords: ["diy", "repair", "woodworking", "3d print", "maker", "build", "restoration", "teardown"] },
  { label: "Fitness & health", keywords: ["workout", "fitness", "gym", "health", "nutrition", "yoga", "running", "crossfit"] },
  { label: "Food & cooking", keywords: ["recipe", "cooking", "chef", "bake", "bbq", "food", "kitchen", "restaurant"] },
  { label: "Comedy & entertainment", keywords: ["comedy", "funny", "sketch", "standup", "entertainment", "reaction", "meme"] },
  { label: "Finance & business", keywords: ["finance", "stock", "investing", "business", "startup", "economy", "market", "crypto", "bitcoin"] },
  { label: "Travel & places", keywords: ["travel", "vlog", "tour", "city guide", "vacation", "hotel", "flight review"] },
  { label: "Art & design", keywords: ["art", "design", "drawing", "animation", "photography", "graphic design", "illustration"] },
  { label: "Sports", keywords: ["sports", "nba", "nfl", "soccer", "football", "highlights", "olympics", "f1"] },
  { label: "Automotive", keywords: ["car review", "automotive", "motorcycle", "driving", "jdm", "ev review", "track day"] },
  { label: "Nature & animals", keywords: ["wildlife", "animal", "dog", "cat", "nature documentary", "ocean", "bird"] },
  { label: "History & documentary", keywords: ["history", "documentary", "ancient", "war", "archaeology", "biography"] },
  { label: "Religion & philosophy", keywords: ["religion", "philosophy", "theology", "bible", "meditation", "spiritual"] },
  { label: "Fashion & beauty", keywords: ["fashion", "makeup", "skincare", "outfit", "hairstyle", "beauty"] },
  { label: "Family & kids", keywords: ["kids", "parenting", "family", "toddler", "cartoon", "nursery"] },
  { label: "Books & writing", keywords: ["book review", "writing", "author", "reading", "novel"] },
  { label: "Home & garden", keywords: ["garden", "home decor", "cleaning", "organization", "interior"] },
  { label: "True crime & legal", keywords: ["true crime", "court", "trial", "detective", "unsolved"] },
  { label: "General & mixed", keywords: ["vlog", "update", "channel", "live", "stream", "q&a", "community"] },
];
