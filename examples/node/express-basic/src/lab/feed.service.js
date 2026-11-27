// Parallel fan-out: Promise.all over friends, each loading posts and looking up every post's
// author (N+1) and scoring it.  GET /api/lab/feed/:userId?friends=40
const { authorRepo, postRepo } = require('./lab.repository');

class RankingService {
  score(post, author) {
    return post.likes * (author.verified ? 1.5 : 1) + (post.id % 7);
  }
}

class FriendFeedLoader {
  constructor(ranking) {
    this.ranking = ranking;
  }
  async load(friendId) {
    const posts = await postRepo.forUser(friendId, 12);
    const out = [];
    for (const post of posts) {
      const author = await authorRepo.byId(post.authorId);
      out.push({ ...post, author: author.name, score: this.ranking.score(post, author) });
    }
    return out;
  }
}

class FeedService {
  constructor(loader) {
    this.loader = loader;
  }
  async build(userId, friends) {
    const ids = Array.from({ length: friends }, (_, i) => userId * 100 + i + 1);
    const perFriend = await Promise.all(ids.map((id) => this.loader.load(id)));
    const all = perFriend.flat().sort((a, b) => b.score - a.score);
    return { userId, friends, posts: all.length, top: all.slice(0, 5) };
  }
}

module.exports = { feed: new FeedService(new FriendFeedLoader(new RankingService())), FeedService, FriendFeedLoader, RankingService };
