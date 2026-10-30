const mongoose = require('mongoose');
const {RecommendationFeedbackStore} = require('../config/storage');
const {getIsMongoConnected} = require('../config/db');

const feedbackSchema = new mongoose.Schema({
  userId:{
    type:String,
    required:true
  },
  recommendationId: {
    type:String,
    required:true
  },
  feedback: {
    type:String,
    enum : ['useful', 'not_useful'],
    required: true
  }
}, {
  timestamps:true
});

feedbackSchema.index(
  {userId: 1, recommendationId:1},
  {unique:true}
);

const MongorecommendationFeedback = mongoose.model(
  'RecommendationFeedback',
  feedbackSchema
);

class RecommendationFeedbackRepo {
  static async findByUser(userId){
    if(getIsMongoConnected()){
      return await MongorecommendationFeedback.find({userId}).lean();
    }

    return recommendationFeedbackStore.find({userId})
  }

  static async saveFeedback(userId,recommendationId, feedback){
    if(getIsMongoConnected()){
      return await MongorecommendationFeedback.findOneAndUpdate(
        {userId, recommendationId},
        {feedback},
        {
          upsert:true,
          new:true,
          runValidators:true,
          setDefaultOnInsert: true
        }
      ).lean();
    }

    const existing = recommendationFeedbackStore.findOne({
      userId, recommendationId
    });

    if(existing){
      return recommendationFeedbackStore.findByIdAndUpdate(
        existing._id || existing.id,
        {feedback}
      );
    }

    return recommendationFeedbackStore.create({
      userId,
      recommendationId,
      feedback
    });
  }
}

module.exports = {
  RecommendationFeedbackRepo,
  MongorecommendationFeedback
};