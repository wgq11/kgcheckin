import { printBlue, printGreen, printMagenta, printRed, printYellow } from "./utils/colorOut.js";
import { close_api, delay, send, startService } from "./utils/utils.js";

// 配置项抽离，方便修改
const CONFIG = {
  SIGN_DELAY: 30 * 1000, // 签到间隔（毫秒）
  MAX_SIGN_TIMES: 8,     // 最大签到次数
  TIMEZONE_OFFSET: 8 * 60 * 60 * 1000 // 时区偏移（+8小时）
};

async function main() {
  let api = null;
  const errorMsg = {};

  try {
    // 1. 参数校验与解析（增加容错）
    const USERINFO = process.env.USERINFO;
    if (!USERINFO) {
      throw new Error("环境变量 USERINFO 未配置");
    }
    let userinfo = [];
    try {
      userinfo = JSON.parse(USERINFO);
      // 校验JSON格式是否为数组
      if (!Array.isArray(userinfo)) {
        throw new Error("USERINFO 格式错误，需为JSON数组");
      }
    } catch (parseErr) {
      throw new Error(`USERINFO 解析失败：${parseErr.message}`);
    }

    // 2. 启动服务
    api = startService();
    await delay(2000);

    // 3. 时间格式化
    const today = new Date();
    today.setTime(today.getTime() + CONFIG.TIMEZONE_OFFSET);
    const date = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0')
    ].join('-');

    // 4. 多账号循环（单个账号异常不终止整体）
    for (const [index, user] of userinfo.entries()) {
      printMagenta(`\n===== 处理第 ${index + 1} 个账号 (userid: ${user.userid || '未知'}) =====`);
      // 校验单个账号的token/userid
      if (!user.token || !user.userid) {
        const errMsg = `账号配置不全：缺少token或userid`;
        printRed(errMsg);
        errorMsg[`账号${index + 1}`] = { msg: errMsg };
        continue;
      }

      const headers = { 'cookie': `token=${user.token}; userid=${user.userid}` };
      let nickname = `userid_${user.userid}`; // 默认昵称

      try {
        // 4.1 验证账号有效性
        const userDetail = await send(`/user/detail?timestrap=${Date.now()}`, "GET", headers);
        if (!userDetail?.data?.nickname) {
          const errMsg = `token过期或账号不存在`;
          printRed(errMsg);
          errorMsg[nickname] = { msg: errMsg };
          continue;
        }
        nickname = userDetail.data.nickname;
        printMagenta(`账号 ${nickname} 开始领取VIP...`);

        // 4.2 听歌领VIP
        printYellow(`开始听歌领取VIP...`);
        const listen = await send(`/youth/listen/song?timestrap=${Date.now()}`, "GET", headers);
        if (listen.status === 1) {
          printGreen("✅ 听歌领取成功");
        } else if (listen.error_code === 130012) {
          printGreen("ℹ️ 今日已领取（听歌）");
        } else {
          const errMsg = `听歌领取失败：${listen.error_msg || `error_code=${listen.error_code}`}`;
          printRed(`❌ ${errMsg}`);
          errorMsg[`${nickname}_listen`] = listen;
        }

        // 4.3 循环签到领VIP
        printYellow("开始签到领取VIP...");
        let signSuccess = true;
        for (let i = 1; i <= CONFIG.MAX_SIGN_TIMES; i++) {
          try {
            const ad = await send(`/youth/vip?timestrap=${Date.now()}`, "GET", headers);
            if (ad.status === 1) {
              printGreen(`✅ 第${i}次签到领取成功`);
              if (i !== CONFIG.MAX_SIGN_TIMES) {
                await delay(CONFIG.SIGN_DELAY);
              }
            } else if (ad.error_code === 30002) {
              printGreen("ℹ️ 今天签到次数已用光");
              break;
            } else {
              const errMsg = `第${i}次签到失败：${ad.error_msg || `error_code=${ad.error_code}`}`;
              printRed(`❌ ${errMsg}`);
              errorMsg[`${nickname}_ad_${i}`] = ad;
              signSuccess = false;
              break;
            }
          } catch (signErr) {
            const errMsg = `第${i}次签到异常：${signErr.message}`;
            printRed(`❌ ${errMsg}`);
            errorMsg[`${nickname}_ad_${i}_exception`] = signErr.message;
            signSuccess = false;
            break;
          }
        }

        // 4.4 获取VIP到期时间（增加空值保护）
        printYellow("获取VIP到期时间...");
        const vip_details = await send(`/user/vip/detail?timestrap=${Date.now()}`, "GET", headers);
        if (vip_details.status === 1) {
          const vipEndTime = vip_details.data?.busi_vip?.[0]?.vip_end_time || '未知';
          printBlue(`📅 今天是：${date}`);
          printBlue(`🎫 VIP到期时间：${vipEndTime}\n`);
        } else {
          const errMsg = `获取VIP信息失败：${vip_details.error_msg || `error_code=${vip_details.error_code}`}`;
          printRed(`❌ ${errMsg}\n`);
          errorMsg[`${nickname}_vip_details`] = vip_details;
        }

      } catch (userErr) {
        // 单个账号异常，记录后继续处理下一个
        const errMsg = `账号 ${nickname} 处理异常：${userErr.message}`;
        printRed(`❌ ${errMsg}`);
        errorMsg[nickname] = { msg: errMsg };
        continue;
      }
    }

    // 5. 异常汇总（有异常仅打印，不终止脚本）
    if (Object.keys(errorMsg).length > 0) {
      printRed("\n❌ 本次运行存在异常，详情如下：");
      console.dir(errorMsg, { depth: null });
      // 改为警告，不抛出错误，避免脚本整体失败
      printYellow("⚠️  脚本已完成所有账号处理（部分账号异常）");
    } else {
      printGreen("\n✅ 所有账号处理完成，无异常！");
    }

  } catch (globalErr) {
    // 全局异常捕获
    printRed(`\n💥 脚本全局异常：${globalErr.message}`);
    process.exit(1);
  } finally {
    // 确保服务关闭
    if (api) close_api(api);
    // 正常退出
    process.exit(0);
  }
}

// 启动脚本
main();
