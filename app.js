console.log(new Date().toTimeString());

const fs = require('fs');
const config = JSON.parse(fs.readFileSync(__dirname + '/config.json'));
const getDeliveryCompletedQuery = require('./db-query');

const mysql = require('promise-mysql');
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const {google} = require('googleapis');
const path = require('path');
const urlencode = require('urlencode');
const moment = require('moment');


const app = express();
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.status(200).send('Hello, PointFairy!!').end();
});

app.get('/dm/new-point', (req, res) => {
    res.sendStatus(200);

    getGoogleApiAccessToken()
        .then(() => getSlackUserCheckStatuses())
        .then(slackUserCheckStatuses => {
            slackUserCheckStatuses.forEach(slackUserCheckStatus => {
                if (slackUserCheckStatus.checkStatus.status !== 'BAN_POINT') {
                    sendSlackMsg('', makeNewPointDMPayload(slackUserCheckStatus))
                        .then(res => console.log(res.data))
                        .catch(err => console.log(err.message));
                }
            });
        })
        .catch(err => console.log(err.message));
});

app.get('/toss/delivery-completed', (req, res) => {
    res.sendStatus(200);

    let checkStatuses;
    let mySqlConnection;
    let completedDeliveries;
    getGoogleApiAccessToken()
        .then(res => getCheckStatuses())
        .then(res => {
            checkStatuses = res;
            return mysql.createConnection(config.db);
        })
        .then((conn) => {
            mySqlConnection = conn;
            return conn.query(getDeliveryCompletedQuery(checkStatuses));
        })
        .then((rows) => {
            completedDeliveries = rows;
            return postDeliveryCompleted(completedDeliveries);
        })
        .then((res) => post3MonthsGoneRemind(completedDeliveries))
        .then(res => console.log(res.data))
        .catch(err => console.log(err.toString()))
        .then(() => {
            if (typeof(mySqlConnection) !== 'undefined') {
                mySqlConnection.end();
            }
        });
});

app.post('/dm/delivery-completed', (req, res) => {
    res.sendStatus(200);

    const allCompletedDeliveries = req.body;
    getGoogleApiAccessToken()
        .then(res => getSlackUserCheckStatuses())
        .then(slackUserCheckStatuses => {
            // 새로운 배송완료만 추리기
            slackUserCheckStatuses.forEach(slackUserCheckStatus => {
                allCompletedDeliveries.forEach(completedDelivery => {
                    if (slackUserCheckStatus.checkStatus.user_id === String(completedDelivery.user_id) && !(slackUserCheckStatus.checkStatus.order_option_ids.includes(completedDelivery.order_option_id + ','))) {
                        slackUserCheckStatus.completedDeliveries.push(completedDelivery);
                    }
                });
            });

            // DM 보내기
            slackUserCheckStatuses.forEach(slackUserCheckStatus => {
                if (slackUserCheckStatus.completedDeliveries.length >= 1) {
                    sendSlackMsg('', makeDeliveryCompletedDMPayload(slackUserCheckStatus))
                        .then(res => {
                            if (res.data.ok === true) { // FIRST_DELIVERY 상태로 바꾸기
                                let status = slackUserCheckStatus.checkStatus.status === 'NONE' ? 'FIRST_DELIVERY' : slackUserCheckStatus.checkStatus.status;
                                let updated_at = slackUserCheckStatus.checkStatus.status === 'NONE' ? moment().format('YYYY-MM-DD') : slackUserCheckStatus.checkStatus.updated_at;
                                let order_option_ids = slackUserCheckStatus.checkStatus.order_option_ids;
                                slackUserCheckStatus.completedDeliveries.forEach(completedDelivery => {
                                    order_option_ids += completedDelivery.order_option_id + ',';
                                });
                                return updateCheckStatus(slackUserCheckStatus.checkStatus, [[status, updated_at, order_option_ids]]);
                            }
                        })
                        .then(res => console.log(res.data))
                        .catch(err => console.log(err.message));
                }
            })
        })
        .catch(err => console.log(err.message));
});

app.post('/dm/3months-gone-remind', (req, res) => {
    res.sendStatus(200);

    const allCompletedDeliveries = req.body;
    getGoogleApiAccessToken()
        .then(res => getSlackUserCheckStatuses())
        .then(slackUserCheckStatuses => {
            // 모든 배송완료 추리기
            slackUserCheckStatuses.forEach(slackUserCheckStatus => {
                allCompletedDeliveries.forEach(completedDelivery => {
                    slackUserCheckStatus.completedDeliveries.push(completedDelivery);
                });
            });

            // DM 보내기
            slackUserCheckStatuses.forEach(slackUserCheckStatus => {
                if (slackUserCheckStatus.checkStatus.status === 'FIRST_DELIVERY' && moment().diff(moment(slackUserCheckStatus.checkStatus.updated_at), 'days') >= 90) {
                    sendSlackMsg('', make3MonthsGoneRemindDMPayload(slackUserCheckStatus))
                        .then(res => {
                            if (res.data.ok === true) {
                                let status = slackUserCheckStatus.checkStatus.status === 'FIRST_DELIVERY' ? 'WARNING' : slackUserCheckStatus.checkStatus.status;
                                let updated_at = slackUserCheckStatus.checkStatus.status === 'FIRST_DELIVERY' ? moment().format('YYYY-MM-DD') : slackUserCheckStatus.checkStatus.updated_at;
                                let order_option_ids = slackUserCheckStatus.checkStatus.order_option_ids;
                                updateCheckStatus(slackUserCheckStatus.checkStatus, [[status, updated_at, order_option_ids]])
                                    .then(res => console.log(res.data))
                                    .catch(err => console.log(err.message));
                            }
                        })
                        .catch(err => console.log(err.message));
                }
            })
        })
        .catch(err => console.log(err.message));
});

app.get('/dm/point-ban', (req, res) => {
    res.sendStatus(200);

    getGoogleApiAccessToken()
        .then(res => getSlackUserCheckStatuses())
        .then(slackUserCheckStatuses => {
            slackUserCheckStatuses.forEach(slackUserCheckStatus => {
                if (slackUserCheckStatus.checkStatus.status === 'WARNING' && moment().diff(moment(slackUserCheckStatus.checkStatus.updated_at), 'days') >= 30) {
                    sendSlackMsg('', makePointBanDMPayload(slackUserCheckStatus))
                        .then(res => {
                            if (res.data.ok === true) {
                                let status = slackUserCheckStatus.checkStatus.status === 'WARNING' ? 'BAN_POINT' : slackUserCheckStatus.checkStatus.status;
                                let updated_at = slackUserCheckStatus.checkStatus.status === 'WARNING' ? moment().format('YYYY-MM-DD') : slackUserCheckStatus.checkStatus.updated_at;
                                let order_option_ids = slackUserCheckStatus.checkStatus.order_option_ids;
                                updateCheckStatus(slackUserCheckStatus.checkStatus, [[status, updated_at, order_option_ids]])
                                    .then(res => console.log(res.data))
                                    .catch(err => console.log(err.message));
                            }
                        })
                        .catch(err => console.log(err.message));
                }
            })
        })
        .catch(err => console.log(err.message));
});

app.post('/command/pointnoti', (req, res) => {
    console.log(req.body);
    res.send('');

    openSlackDlg(req.body.trigger_id, makePointNotiDlgPayload())
        .then(res => console.log(res.data))
        .catch(err => console.log(err.toString()));
});

app.post('/command/pointbanlist', (req, res) => {
    console.log(req.body);
    res.send('');

    getGoogleApiAccessToken()
        .then(res => getCheckStatuses())
        .then(checkStatuses => {
            const banCheckStatuses = checkStatuses.filter(checkStatus => checkStatus.status === 'BAN_POINT')
            return sendSlackMsg(req.body.response_url, makePointBanListMsgPayload(banCheckStatuses));
        })
        .then(res => console.log(res.data))
        .catch(err => console.log(err.toString()));
});

app.post('/command/cardshare', (req, res) => {
    console.log(req.body);
    res.send('');

    openSlackDlg(req.body.trigger_id, makeCardShareDlgPayload())
        .then(res => console.log(res.data))
        .catch(err => console.log(err.toString()));
});

app.post('/interact', (req, res) => {
    console.log(req.body);
    res.send('');

    const body = JSON.parse(req.body.payload);
    if (body.callback_id === 'notify-point') {
        getSlackUsers()
            .then(res => {
                return sendSlackMsg('', makePointNotiMsgPayload(res, body.submission.channel, body.submission.reward_kind, body.submission.content))
            })
            .then(res => console.log(res.data))
            .catch(err => console.log(err.toString()));
    }
    else if (body.callback_id === 'open-card-sharing-dlg') {
        openSlackDlg(body.trigger_id, makeCardShareDlgPayload())
            .then(res => console.log(res.data))
            .catch(err => console.log(err.toString()));
    }
    else if (body.callback_id === 'share-card') {
        let checkStatuses;
        let myCheckStatus;
        let cardUrls = [];
        let mySlackUser;
        getGoogleApiAccessToken()
            .then(res => getCheckStatuses())
            .then(res => {
                checkStatuses = res;
                return getSlackUser(body.user.id);
            })
            .then(res => {
                mySlackUser = res.data.user;

                for (const idx in checkStatuses) {
                    if (mySlackUser.profile.display_name === checkStatuses[idx].nickname) {
                        myCheckStatus = checkStatuses[idx];
                        break;
                    }
                }
                cardUrls.push(body.submission.link_url_1);
                if (body.submission.link_url_2) {
                    cardUrls.push(body.submission.link_url_2);
                }
                if (body.submission.link_url_3) {
                    cardUrls.push(body.submission.link_url_3);
                }
                if (body.submission.link_url_4) {
                    cardUrls.push(body.submission.link_url_4);
                }
                if (body.submission.link_url_5) {
                    cardUrls.push(body.submission.link_url_5);
                }

                return appendCardSharings(moment().format('YYYY-MM-DD'), mySlackUser.profile.display_name, cardUrls);
            })
            .then(chainResults => updateCheckStatus(myCheckStatus, [['NONE', moment().format('YYYY-MM-DD'), myCheckStatus.order_option_ids]]))
            .then(res => getCardImgUrls(cardUrls))
            .then(res => sendSlackMsg(body.response_url, makeCardSharedMsgPayload(mySlackUser, res)))
            .then(res => console.log(res.data))
            .catch(err => console.log(err.toString()));
    }
});


function postDeliveryCompleted(rows) {
    let url = config.server.domain + "/dm/delivery-completed";
    /*TODO 테스트 코드*/
    // url = 'http://localhost:12000/dm/delivery-completed';
    /*END*/
    return axios.post(url, JSON.stringify(rows), {
        headers: {'Content-Type': 'application/json'}
    });
}

function post3MonthsGoneRemind(rows) {
    let url = config.server.domain + "/dm/3months-gone-remind";
    /*TODO 테스트 코드*/
    // url = 'http://localhost:12000/dm/3months-gone-remind';
    /*END*/
    return axios.post(url, JSON.stringify(rows), {
        headers: {'Content-Type': 'application/json'}
    });
}


// google API
const tokenStorage = {
    access_token: null,
    token_type: null,
    expiry_date: null
};

function getGoogleApiAccessToken() {
    return new Promise(function (resolve, reject) {
        const jwt = new google.auth.JWT(
            null,
            path.join(__dirname, 'google-service-account.json'), //키 파일의 위치
            null,
            [
                'https://www.googleapis.com/auth/spreadsheets.readonly',
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/drive.readonly',
                'https://www.googleapis.com/auth/drive.file',
                'https://www.googleapis.com/auth/drive'
            ],
            ''
        );

        jwt.authorize(function (err, tokens) {
            if (err) {
                reject(err)
                return;
            }
            tokenStorage.access_token = tokens.access_token;
            tokenStorage.token_type = tokens.token_type;
            tokenStorage.expiry_date = tokens.expiry_date;
            resolve();
        });
    });
}

function getCheckStatuses() {
    return axios
        .get('https://sheets.googleapis.com/v4/spreadsheets/' + urlencode(config.sheet.sheets_id) + '/values/' + urlencode(config.sheet.check_status.name + '!' + config.sheet.check_status.range_start_col + '' + config.sheet.check_status.range_start_row + ':' + config.sheet.check_status.range_end_col), {
            headers: {
                Authorization: 'Bearer ' + tokenStorage.access_token
            }
        })
        .then(res => {
            const checkStatuses = [];
            for (const idx in res.data.values) {
                const row = res.data.values[idx];
                const checkStatus = {
                    nickname: row[config.sheet.check_status.nickname_col_idx],
                    user_id: row[config.sheet.check_status.user_id_col_idx],
                    status: row[config.sheet.check_status.status_col_idx],
                    updated_at: row[config.sheet.check_status.updated_at_col_idx],
                    order_option_ids: row[config.sheet.check_status.order_option_ids_col_idx],
                    idx: Number(idx)
                };
                if (typeof(checkStatus.order_option_ids) === 'undefined') {
                    checkStatus.order_option_ids = '';
                }
                checkStatuses.push(checkStatus);
            }
            return new Promise(resolve => resolve(checkStatuses));
        })
}

function getCardSharings() {
    return axios
        .get('https://sheets.googleapis.com/v4/spreadsheets/' + urlencode(config.sheet.sheets_id) + '/values/' + urlencode(config.sheet.card_share.name + '!' + config.sheet.card_share.range_start_col + '' + config.sheet.card_share.range_start_row + ':' + config.sheet.card_share.range_end_col), {
            headers: {
                Authorization: 'Bearer ' + tokenStorage.access_token
            }
        })
        .then(res => {
            const cardSharings = [];
            for (const idx in res.data.values) {
                const row = res.data.values[idx];
                const cardSharing = {
                    created_at: row[config.sheet.card_share.created_at_col_idx],
                    nickname: row[config.sheet.card_share.nickname_col_idx],
                    card_link: row[config.sheet.card_share.card_link_col_idx],
                    idx: Number(idx)
                };
                cardSharings.push(cardSharing);
            }
            return new Promise(resolve => resolve(cardSharings));
        })
}

function updateCheckStatus(checkStatus, values) {
    const requestBody = {values};
    return axios.put('https://sheets.googleapis.com/v4/spreadsheets/' + urlencode(config.sheet.sheets_id) + '/values/' +
        urlencode(config.sheet.check_status.name + '!' + config.sheet.check_status.status_col + '' + (config.sheet.check_status.range_start_row + checkStatus.idx) + ':' + config.sheet.check_status.order_option_ids_col + '' + (config.sheet.check_status.range_start_row + checkStatus.idx)) +
        '?valueInputOption=USER_ENTERED', requestBody,
        {
            headers: {
                Authorization: 'Bearer ' + tokenStorage.access_token
            }
        }
    );
}

function appendCardSharings(createdAt, nickname, linkUrls) {
    return linkUrls
        .reduce((promiseChain, linkUrl) => {
            return promiseChain.then((chainResults) => {
                return appendCardSharing(createdAt, nickname, linkUrl).then(res => {
                    chainResults.push(res);
                    return new Promise(resolve => resolve(chainResults));
                });
            });
        }, Promise.resolve([]));
}

function appendCardSharing(createdAt, nickname, linkUrl) {
    const requestBody = {
        values: [[createdAt, nickname, linkUrl]]
    };
    return axios.post('https://sheets.googleapis.com/v4/spreadsheets/' + urlencode(config.sheet.sheets_id) + '/values/' +
        urlencode(config.sheet.card_share.name + '!' + config.sheet.card_share.range_start_col + ':' + config.sheet.card_share.range_end_col) +
        ':append?valueInputOption=USER_ENTERED', requestBody,
        {
            headers: {
                Authorization: 'Bearer ' + tokenStorage.access_token
            }
        }
    );
}


// slack
function getSlackUserCheckStatuses() {
    let slackUsers;
    let checkStatuses;
    return getSlackUsers()
        .then(res => {
            slackUsers = res;
            return getCheckStatuses();
        })
        .then(res => {
            checkStatuses = res;

            const slackUserCheckStatuses = [];
            slackUsers.forEach(slackUser => {
                for (const idx in  checkStatuses) {
                    const checkStatus = checkStatuses[idx];
                    if (slackUser.profile.display_name === checkStatus.nickname) {
                        slackUserCheckStatuses.push({slackUser, checkStatus, completedDeliveries: []})
                        break;
                    }
                }
            });
            return new Promise(resolve => resolve(slackUserCheckStatuses));
        })
}

function getSlackUsers() {
    return axios
        .get('https://slack.com/api/users.list', {
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + config.slack.bot_access_token
            }
        })
        .then(res => {
            const liveSlackUsers = res.data.members.filter(member => {
                if (member.deleted || member.is_bot || member.id === 'USLACKBOT' || member.is_restricted) {
                    return false;
                }
                return true;
            });
            return new Promise(resolve => resolve(liveSlackUsers));
        })
}

function getSlackUser(userId) {
    return axios
        .get('https://slack.com/api/users.info?user=' + userId, {
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + config.slack.bot_access_token
            }
        });
}

function sendSlackMsg(responseUrl, payload) {
    return axios.post(responseUrl ? responseUrl : 'https://slack.com/api/chat.postMessage', JSON.stringify(payload), {
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + config.slack.bot_access_token
        }
    });
}

function openSlackDlg(triggerId, payload) {
    return axios.post('https://slack.com/api/dialog.open', JSON.stringify({
        trigger_id: triggerId,
        dialog: JSON.stringify(payload)
    }), {
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + config.slack.bot_access_token}
    });
}

function makeNewPointDMPayload(slackUserCheckStatus) {
    /*TODO 테스트 코드*/
    slackUserCheckStatus.slackUser.id = 'CDWKRAHEE';
    /*END*/

    return {
        channel: slackUserCheckStatus.slackUser.id,
        as_user: true,
        attachments: [
            {
                title: '안녕:wave::skin-tone-3:! 난 오집요정:male_fairy::skin-tone-3:, 꾸미기포인트를 주려고 나타났지!:tada:',
                color: '#35c5f0',
                image_url: 'https://image.ohou.se/image/resize/bucketplace-v2-development/uploads-cards-projects-1544438851346_CL9EV2.jpg/2560/none',
                text:
                '내가 주는 꾸미기포인트로 집을 예쁘게 꾸며주면 좋겠어 :slightly_smiling_face:\n' +
                '"오늘의집"에 예쁜 사진도 올리고 리뷰도 쓰면서 좀 더 풍성한 오늘의집을 만들어나가자~~!\n' +
                '포인트 사용 후 리뷰, 사진을 남기지 않을 경우 난 다시 나타날 수 없으니 꼭 기억해줘:pray::skin-tone-3:\n' +
                '포인트의 유효기간은 4개월이니 잊지말고 꼭 사용하도록~!~!\n' +
                '우리도 예쁜 집에 살 수 있어~! 빠빠룽:wave::skin-tone-3::wave::skin-tone-3::wave::skin-tone-3:\n'
            }
        ]
    };
}

function makeDeliveryCompletedDMPayload(slackUserCheckStatus) {
    /*TODO 테스트 코드*/
    slackUserCheckStatus.slackUser.id = 'CDWKRAHEE';
    /*END*/

    const json = {
        channel: slackUserCheckStatus.slackUser.id,
        as_user: true,
        attachments: []
    };
    json.attachments.push({
        title: '내가 준 포인트 사용해줬구나~!!!:raised_hands::skin-tone-3:',
        color: '#35c5f0',
        text:
        '주문한 물건은 잘 받았어?? 맘에 들어??\n' +
        '다른 유저에게도 도움이 될만한 사진과 리뷰를 업로드 하는거 잊지말구!:laughing:',
    });
    let prodCnt = 0;
    for (const idx in slackUserCheckStatus.completedDeliveries) {
        if (prodCnt >= 10) {
            break;
        }
        const completedDelivery = slackUserCheckStatus.completedDeliveries[idx];
        json.attachments.push({
            title: completedDelivery.brand_name,
            text: completedDelivery.name,
            thumb_url: completedDelivery.image_url,
            color: '#35c5f0',
        });
        prodCnt++;
    }
    json.attachments.push({
        text: '',
        callback_id: 'open-card-sharing-dlg',
        actions: [
            {
                type: 'button',
                text: '사진 올리러 가기',
                url: "https://ohou.se/snapshots/upload_card",
            },
            {
                name: 'open-card-sharing-dlg',
                type: 'button',
                text: '사진 링크 남기기(단축키: /up)',
            }
        ],
        color: '#35c5f0',
    });
    return json;
}

function make3MonthsGoneRemindDMPayload(slackUserCheckStatus) {
    /*TODO 테스트 코드*/
    slackUserCheckStatus.slackUser.id = 'CDWKRAHEE';
    /*END*/

    const json = {
        channel: slackUserCheckStatus.slackUser.id,
        as_user: true,
        attachments: []
    };
    json.attachments.push({
        title: '안뇽:woman-raising-hand::skin-tone-3:! 사진 업로드 하는 거 잊지 않았지?!',
        color: '#35c5f0',
        text: '업로드 해주지 않으면 난 다시 나타날 수 없단말야..(쥬륵..:pepe:)',
    });
    let prodCnt = 0;
    for (const idx in slackUserCheckStatus.completedDeliveries) {
        if (prodCnt >= 3) {
            break;
        }
        const completedDelivery = slackUserCheckStatus.completedDeliveries[idx];
        json.attachments.push({
            title: completedDelivery.brand_name,
            text: completedDelivery.name,
            thumb_url: completedDelivery.image_url,
            color: '#35c5f0',
        });
        prodCnt++;
    }
    json.attachments.push({
        text: '',
        callback_id: 'open-card-sharing-dlg',
        actions: [
            {
                type: 'button',
                text: '사진 올리러 가기',
                url: "https://ohou.se/snapshots/upload_card",
            },
            {
                name: 'open-card-sharing-dlg',
                type: 'button',
                text: '사진 링크 남기기(단축키: /up)',
            }
        ],
        color: '#35c5f0',
    });
    return json;
}

function makePointBanDMPayload(slackUserCheckStatus) {
    /*TODO 테스트 코드*/
    slackUserCheckStatus.slackUser.id = 'CDWKRAHEE';
    /*END*/

    const json = {
        channel: slackUserCheckStatus.slackUser.id,
        as_user: true,
        attachments: []
    };
    json.attachments.push({
        title: '오집요정 등장이오!:the_horns::skin-tone-3:',
        color: '#35c5f0',
        text: '안타깝게도 우디가 약속을 지켜주지 않아서\n' +
        '담달에는 포인트를 줄 수 없게 되었어(유감:pepe:)\n' +
        '하지만 언제든 사진을 업로드 해준다면 다음달엔 포인트를 가지고 와줄게!!',
    });
    return json;
}

function makePointNotiDlgPayload() {
    const json = {
        callback_id: 'notify-point',
        title: '포인트 공지 쓰기',
        submit_label: '보내기',
        elements: [
            {
                type: 'select',
                label: '공지 채널',
                name: 'channel',
                placeholder: '',
                value: 'noti',
                optional: false,
                options: [
                    {label: 'a_공지_및_알림', value: 'noti'},
                    {label: 'z_성과공유방', value: 'achievement'}
                ]
            },
            {
                type: 'select',
                label: '리워드 종류',
                name: 'reward_kind',
                placeholder: '',
                value: null,
                optional: false,
                options: [
                    {label: '아이데이션 리워드', value: 'ideation'},
                    {label: '버그 리워드', value: 'bug'}
                ]
            },
            {
                type: 'textarea',
                label: '내용',
                name: 'content',
                placeholder: '@미나x2 @우디 @비스코 님에게 버그신고 포인트, @미나 님에게 아이데이션 포인트',
                value: null,
                optional: false,
            }
        ]
    };
    return json;
}

function makePointNotiMsgPayload(slackUsers, channel, reward_kind, content) {
    let mentions = '';
    slackUsers.forEach(slackUser => {
        if (content.includes('@' + slackUser.profile.display_name)) {
            content = content.replace('@' + slackUser.profile.display_name, '<@' + slackUser.id + '>');
            if(mentions.length >= 1) {
                mentions += ', ';
            }
            mentions += slackUser.profile.display_name;
        }
    });
    const json = {
        channel: channel === 'achievement' ? config.slack.achievement_channel_id : config.slack.noti_channel_id,
        as_user: false,
        attachments: []
    };
    if (reward_kind === 'ideation') {
        json.attachments.push({
            title: '안뇽! 오집요정이야:the_horns::skin-tone-3:',
            color: '#35c5f0',
            text: content + '\n' + mentions + '에게 아이데이션 포인트를 선물:gift:하러 왔어!\n' +
            '모두 고마워~!~!',
        })
    }
    else {
        json.attachments.push({
            title: '안녕:the_horns::skin-tone-3: 오집요정이야!',
            color: '#35c5f0',
            text: content + '\n' + '이번달 ' + mentions + '가 버그를 찾아줬어!\n' +
            '500포인트씩 선물로 줄게!\n' +
            '고마워 버그캐쳐~!~!',
        })
    }

    /*TODO 테스트 코드*/
    json.channel = 'CDWKRAHEE';
    /*END*/

    return json;
}

function makePointBanListMsgPayload(checkStatuses) {
    let text = '';
    checkStatuses.forEach(checkStatus => {
        text += checkStatus.nickname + ' (' + checkStatus.updated_at + ')\n';
    });
    if (text.length === 0) {
        text = '제외 대상이 없습니다.';
    }

    return {
        attachments: [
            {
                title: '포인트 지급제외 대상 조회\n닉네임(제외되기 시작한 날짜)\n----------------------------------------',
                color: '#35c5f0',
                text: text,
            }
        ]
    };
}

function makeCardShareDlgPayload() {
    const json = {
        callback_id: 'share-card',
        title: '꾸미기포인트를 사용한 사진 공유',
        submit_label: '저장',
        elements: [
            {
                type: 'text',
                label: '링크1 (필수)',
                name: 'link_url_1',
                placeholder: 'https://ohou.se/contents/card_collections/1234',
                value: null,
                subtype: 'url',
                optional: false,
                hint: '사진이나 포토리뷰 링크를 공유해주세요. 이 입력창은 /up으로 다시 띄울 수 있어요.',
            },
            {
                type: 'text',
                label: '링크2 (선택)',
                name: 'link_url_2',
                placeholder: '',
                value: null,
                subtype: 'url',
                optional: true,
            },
            {
                type: 'text',
                label: '링크3 (선택)',
                name: 'link_url_3',
                placeholder: '',
                value: null,
                subtype: 'url',
                optional: true,
            },
            {
                type: 'text',
                label: '링크4 (선택)',
                name: 'link_url_4',
                placeholder: '',
                value: null,
                subtype: 'url',
                optional: true,
            },
            {
                type: 'text',
                label: '링크5 (선택)',
                name: 'link_url_5',
                placeholder: '',
                value: null,
                subtype: 'url',
                optional: true,
            }
        ]
    };
    return json;
}

function makeCardSharedMsgPayload(slackUser, cardImgUrls) {
    const json = {
        attachments: [
            {
                title: '땡큐 ' + slackUser.profile.display_name + '!! ' + slackUser.profile.display_name + ' 덕분에 오늘의집이 풍성해졌어:tada:',
                color: '#35c5f0',
                text: '',
            }
        ]
    };

    for (const idx in cardImgUrls) {
        json.attachments.push({
            color: '#35c5f0',
            image_url: cardImgUrls[idx],
            text: '',
        });
    }

    return json;
}


// ohouse
function getCardImgUrls(cardUrls) {
    return cardUrls
        .reduce((promiseChain, cardUrl) => {
            return promiseChain.then((chainResults) => {
                return getCardImgUrl(cardUrl).then(res => {
                    chainResults.push(res);
                    return new Promise(resolve => resolve(chainResults));
                });
            });
        }, Promise.resolve([]));
}

function getCardImgUrl(url) {
    let jsonUrl;
    let isCollection;
    if (url.includes('/contents/card_collections/')) {
        jsonUrl = url + '.json';
        isCollection = true;
    } else {
        jsonUrl = url + '/detail.json';
        isCollection = false;
    }
    return axios
        .get(jsonUrl, {headers: {'Content-Type': 'application/json'}})
        .then(res => {
            return new Promise(resolve => resolve(isCollection ? res.data.cards[0].image_url : res.data.image_url));
        });
}

// Start the server
const PORT = process.env.PORT || 12000;
// const PORT = process.env.PORT || 55000;
app.listen(PORT, () => {
    console.log(`App listening on port ${PORT}`);
    console.log('Press Ctrl+C to quit.');
});