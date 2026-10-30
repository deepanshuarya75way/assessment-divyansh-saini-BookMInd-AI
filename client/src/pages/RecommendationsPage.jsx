import React, { useState } from 'react';
import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Compass, Sparkles, Plus, Check, AlertCircle, RefreshCw, ThumbsUp, ThumbsDown } from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Button } from '../components/ui/Button';
import { BookCover } from '../components/books/BookCover';
import { SkeletonCard } from '../components/ui/Skeleton';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

const fetchRecommendations = async ({ signal }) => {
  const res = await axios.get('/api/ai/recommendations', { signal });
  return res.data.recommendations || [];
};

export const RecommendationsPage = () => {
  const { user } = useAuth();
  const [addingTitle, setAddingTitle] = useState(null);
  const [addedMap, setAddedMap] = useState({});
  const [feedbackLoadingId, setFeedbackLoadingId] = useState(null);
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: recommendations = [],
    isLoading: loading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['recommendations', user?.id],
    queryFn: fetchRecommendations,
    staleTime: 10 * 60 * 1000, // 10 min client-side freshness (server caches for 12h)
    enabled: !!user?.id,
    retry: 1,
  });

  const showLoading = !user?.id || loading;

  const handleRefresh = async () => {
    // Force server-side cache invalidation by using ?refresh=true
    await axios.get('/api/ai/recommendations?refresh=true');
    queryClient.invalidateQueries({ queryKey: ['recommendations', user?.id] });
  };

  const handleAddRecommendation = async (rec) => {
    setAddingTitle(rec.title);
    try {
      await axios.post('/api/books', {
        title: rec.title,
        authors: [rec.author],
        genres: [rec.genre],
        status: 'want_to_read',
        description: rec.reason
      });

      setAddedMap((prev) => ({ ...prev, [rec.title]: true }));
      addToast(`"${rec.title}" added to your library!`, 'success');
      // Books changed — invalidate cache so dashboard reflects it
      queryClient.invalidateQueries({ queryKey: ['books', user?.id] });
    } catch (err) {
      addToast(err.response?.data?.message || 'Could not add book.', 'error');
    } finally {
      setAddingTitle(null);
    }
  };

  const handleFeedback = async (rec, feedback) => {

    console.log('Feedback button clicked')
    console.log('recommendation', rec);
    console.log('rec Id:', rec.id);

    if(!rec.id){
      addToast('Recommendation ID is missing. Please refresh.', 'error');
        return;
    }

    try{
      await axios.put(`/api/ai/recommendations/${rec.id}/feedback`,{feedback});

      queryClient.setQueryData(
        ['recommendations', user?.id],
        (oldrecommendations = []) => oldrecommendations.map(item => item.id === rec.id?{...item, userFeedback: feedback}: item
        )
      );

      addToast('Thanks for sharing your feedback!', 'success');
    }catch(err){
      addToast(
        err.response?.data?.message || 'Could not save feedback.', 'error'
      );
    }finally{
      setFeedbackLoadingId(null)
    }
  }

  return (
    <AppShell>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', maxWidth: '1000px', margin: '0 auto' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-primary)', marginBottom: '4px' }}>
              <Compass size={20} />
              <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Personalized Insights</span>
            </div>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.85rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Books Picked for You
            </h1>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Tailored recommendations synthesized from your reading history, ratings, and note topics.
            </p>
          </div>

          <Button variant="outline" icon={Sparkles} isLoading={isFetching} onClick={handleRefresh}>
            Refresh Picks
          </Button>
        </div>

        {/* Error state — graceful, not broken */}
        {isError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '20px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', color: 'var(--text-secondary)' }}>
            <AlertCircle size={18} color="var(--text-muted)" />
            <span style={{ flex: 1, fontSize: '0.9rem' }}>
              Recommendations are temporarily unavailable. {error?.response?.data?.message || ''}
            </span>
            <Button size="sm" variant="outline" icon={RefreshCw} onClick={() => refetch()}>
              Try Again
            </Button>
          </div>
        )}

        {/* Recommendations List */}
        {showLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : !isError && recommendations.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '24px' }}>
            {recommendations.map((rec, idx) => {
              const isAdded = addedMap[rec.title];
              const isAdding = addingTitle === rec.title;

              return (
                <div
                  key={idx}
                  style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-xl)', padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '16px', boxShadow: 'var(--shadow-sm)' }}
                >
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <div style={{ width: '80px', flexShrink: 0 }}>
                      <BookCover title={rec.title} authors={[rec.author]} height="110px" />
                    </div>
                    <div>
                      <span style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {rec.genre || 'Recommended'}
                      </span>
                      <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px', lineHeight: 1.3 }}>
                        {rec.title}
                      </h3>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>By {rec.author}</p>
                    </div>
                  </div>

                  <div style={{ backgroundColor: 'var(--bg-surface-subtle)', padding: '14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
                      Why we think you'll like it:
                    </span>
                    <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                      {rec.reason}
                    </p>
                  </div>

                  <div style={{
                    padding: '12px 0',
                    borderTop: '1px solid var(--border-color)'
                  }}>
                    <p style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-secondary)',
                      marginBottom:'10px'
                    }}>
                      Was this recommendation useful?
                    </p>

                    <div style={{display: 'flex', gap:'10px'}}>
                      <button
                       type ="button"
                       disabled={feedbackLoadingId===rec.Id}
                       onClick={() => handleFeedback(rec, 'useful')}
                       aria-label="Mark recommendation as useful"
                       style={{
                        display:'flex',
                        alignItems:'center',
                        gap:'6px',
                        padding:'8px 12px',
                        borderRadius:'8px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: rec.userFeedback === 
                        'useful'
                        ?'var(--bg-surface-subtle)'
                        :'transparent',
                        color: rec.userFeedback == 'useful'
                        ? 'var(--accent-primary)'
                        :'var(--text-secondary)',
                        cursor:'pointer',
                        opacity:feedbackLoadingId === rec.id? 0.6 : 1
                       }}
                       >
                        <ThumbsUp size = {16}/>
                        <span style = {{fontSize : '0.8rem'}}>Useful</span>

                      </button>

                      <button
                       type ="button"
                       disabled={feedbackLoadingId===rec.Id}
                       onClick={() => handleFeedback(rec, 'not_useful')}
                       aria-label="Mark recommendation as not useful"
                       style={{
                        display:'flex',
                        alignItems:'center',
                        gap:'6px',
                        padding:'8px 12px',
                        borderRadius:'8px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: rec.userFeedback === 
                        'useful'
                        ?'var(--bg-surface-subtle)'
                        :'transparent',
                        color: rec.userFeedback == 'useful'
                        ? 'var(--accent-primary)'
                        :'var(--text-secondary)',
                        cursor:'pointer',
                        opacity:feedbackLoadingId === rec.id? 0.6 : 1
                       }}
                       >
                        <ThumbsDown size = {16}/>
                        <span style = {{fontSize : '0.8rem'}}>Not useful</span>

                      </button>
                    </div>

                  </div>

                  <div style={{ marginTop: 'auto' }}>
                    {isAdded ? (
                      <Button variant="secondary" size="sm" style={{ width: '100%' }} disabled icon={Check}>
                        Added to Library
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        style={{ width: '100%' }}
                        isLoading={isAdding}
                        icon={Plus}
                        onClick={() => handleAddRecommendation(rec)}
                      >
                        Add to Library
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : !isError && !showLoading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
            Read a few books and capture notes to enable AI recommendations!
          </div>
        ) : null}

      </div>
    </AppShell>
  );
};
