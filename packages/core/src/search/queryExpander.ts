import { OllamaClient } from '../vectorizer/ollama'

/**
 * 查询扩展器 - 将自然语言查询转换为多个搜索关键词
 */
export class QueryExpander {
  private ollamaClient: OllamaClient

  constructor(ollamaClient: OllamaClient) {
    this.ollamaClient = ollamaClient
  }

  /**
   * 扩展用户查询，生成多个相关关键词
   */
  async expandQuery(query: string): Promise<{
    originalQuery: string
    keywords: string[]
    expandedQueries: string[]
  }> {
    const prompt = `你是一个代码搜索助手。用户想要搜索代码，请帮助将用户的自然语言查询转换为有效的搜索关键词。

用户查询: "${query}"

请分析这个查询，提取关键信息：
1. 核心业务关键词（中英文）- 最重要，必须具有区分度
2. 相关的技术术语
3. 可能的文件名、函数名、变量名

重要原则：
- 关键词必须具有区分度，避免"逻辑"、"流程"、"处理"等通用词
- 优先提取业务领域词汇（如"外卖"、"模板"、"订单"）
- 英文关键词要准确，不要过度泛化（如用"takeout"而非"process"）
- 扩展查询要保持原意，不要偏离

以 JSON 格式返回，格式如下：
{
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "expandedQueries": ["扩展查询1", "扩展查询2"]
}

示例1：
用户查询: "小程序的登录流程"
返回:
{
  "keywords": ["login", "登录", "auth", "小程序", "miniprogram", "signin"],
  "expandedQueries": ["小程序登录实现", "微信小程序用户认证"]
}

示例2：
用户查询: "外卖模板的逻辑是什么样的"
返回:
{
  "keywords": ["外卖", "模板", "template", "takeout", "delivery", "waimai"],
  "expandedQueries": ["外卖订单模板", "外卖配送模板逻辑"]
}

只返回 JSON，不要其他内容。`

    try {
      const response = await this.ollamaClient.chat([
        {
          role: 'user',
          content: prompt,
        },
      ])

      // 提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0])
        return {
          originalQuery: query,
          keywords: result.keywords || [],
          expandedQueries: result.expandedQueries || [],
        }
      }
    } catch (error) {
      console.error('查询扩展失败:', error)
    }

    // 降级：简单的关键词提取
    return {
      originalQuery: query,
      keywords: this.extractSimpleKeywords(query),
      expandedQueries: [query],
    }
  }

  /**
   * 简单的关键词提取（降级方案）
   */
  private extractSimpleKeywords(query: string): string[] {
    const keywords: string[] = []

    // 常见的功能关键词映射
    const keywordMap: Record<string, string[]> = {
      登录: ['login', 'auth', 'signin'],
      注册: ['register', 'signup'],
      支付: ['pay', 'payment', 'checkout'],
      订单: ['order'],
      用户: ['user', 'member'],
      商品: ['product', 'goods', 'item'],
      购物车: ['cart', 'shopping'],
      地址: ['address', 'location'],
      优惠券: ['coupon', 'discount'],
      小程序: ['miniprogram', 'weapp'],
      微信: ['wechat', 'wx'],
      外卖: ['takeout', 'delivery', 'waimai'],
      模板: ['template', 'tpl'],
      配送: ['delivery', 'shipping'],
      骑手: ['rider', 'courier'],
      店铺: ['shop', 'store'],
      分类: ['category', 'classify'],
      搜索: ['search', 'query'],
      评价: ['review', 'comment', 'rating'],
      收藏: ['favorite', 'collect'],
      分享: ['share'],
      推广: ['promote', 'promotion'],
      分销: ['distribution', 'dist'],
      会员: ['member', 'vip'],
      积分: ['point', 'credit'],
      余额: ['balance', 'wallet'],
      退款: ['refund'],
      售后: ['aftersale', 'service'],
    }

    // 提取映射的关键词
    for (const [cn, en] of Object.entries(keywordMap)) {
      if (query.includes(cn)) {
        keywords.push(cn, ...en)
      }
    }

    // 如果没有匹配，返回原查询的分词
    if (keywords.length === 0) {
      // 简单分词：提取2-4字的词组
      const words = query.match(/[\u4e00-\u9fa5]{2,4}/g) || []
      keywords.push(...words, query)
    }

    return [...new Set(keywords)]
  }
}
