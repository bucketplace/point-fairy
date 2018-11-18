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

    getAccessToken()
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
    getAccessToken()
        .then(res => getCheckStatuses())
        .then(res => {
            checkStatuses = res;
            return mysql.createConnection(config.db);
        })
        .then((conn) => {
            mySqlConnection = conn;
            return conn.query(getDeliveryCompletedQuery(checkStatuses));
        })
        .then((rows) => postDeliveryCompleted(rows))
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
    getAccessToken()
        .then(res => getSlackUserCheckStatuses())
        .then(slackUserCheckStatuses => {
            slackUserCheckStatuses.forEach(slackUserCheckStatus => {
                allCompletedDeliveries.forEach(completedDelivery => {
                    if (slackUserCheckStatus.checkStatus.user_id === String(completedDelivery.user_id) && !(slackUserCheckStatus.checkStatus.order_option_ids.includes(completedDelivery.order_option_id + ','))) {
                        slackUserCheckStatus.completedDeliveries.push(completedDelivery);
                    }
                });
            });

            slackUserCheckStatuses.forEach(slackUserCheckStatus => {
                if (slackUserCheckStatus.completedDeliveries.length >= 1) {
                    sendSlackMsg('', makeDeliveryCompletedDMPayload(slackUserCheckStatus))
                        .then(res => {
                            if (res.data.ok === true) {
                                let status = slackUserCheckStatus.checkStatus.status === 'NONE' ? 'FIRST_DELIVERY' : slackUserCheckStatus.checkStatus.status;
                                let updated_at = slackUserCheckStatus.checkStatus.status === 'NONE' ? moment().format('YYYY-MM-DD') : slackUserCheckStatus.checkStatus.updated_at;
                                let order_option_ids = slackUserCheckStatus.checkStatus.order_option_ids;
                                slackUserCheckStatus.completedDeliveries.forEach(completedDelivery => {
                                    order_option_ids += completedDelivery.order_option_id + ',';
                                });
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

app.get('/dm/3months-gone-remind', (req, res) => {
    res.sendStatus(200);

    getAccessToken()
        .then(res => getSlackUserCheckStatuses())
        .then(slackUserCheckStatuses => {
            slackUserCheckStatuses.forEach(slackUserCheckStatus => {
                const diffDays = moment().diff(moment(slackUserCheckStatus.checkStatus.updated_at), 'days');
                if (diffDays >= 90 && diffDays < 120) {
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

    getAccessToken()
        .then(res => getSlackUserCheckStatuses())
        .then(slackUserCheckStatuses => {
            slackUserCheckStatuses.forEach(slackUserCheckStatus => {
                if (moment().diff(moment(slackUserCheckStatus.checkStatus.updated_at), 'days') >= 120) {
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

    getAccessToken()
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
                return sendSlackMsg('', makePointNotiMsgPayload(res, body.submission.content))
            })
            .then(res => console.log(res.data))
            .catch(err => console.log(err.toString()));
    } else if (body.callback_id === 'share-card') {
        let checkStatuses;
        let myCheckStatus;
        getAccessToken()
            .then(res => getCheckStatuses())
            .then(res => {
                checkStatuses = res;
                return getSlackUser(body.user.id);
            })
            .then(res => {
                for (const idx in checkStatuses) {
                    if (res.data.user.profile.display_name === checkStatuses[idx].nickname) {
                        myCheckStatus = checkStatuses[idx];
                        break;
                    }
                }
                const urlLinks = [];
                urlLinks.push(body.submission.link_url_1);
                if (body.submission.link_url_2) {
                    urlLinks.push(body.submission.link_url_2);
                }
                if (body.submission.link_url_3) {
                    urlLinks.push(body.submission.link_url_3);
                }
                if (body.submission.link_url_4) {
                    urlLinks.push(body.submission.link_url_4);
                }
                if (body.submission.link_url_5) {
                    urlLinks.push(body.submission.link_url_5);
                }

                return appendCardSharings(moment().format('YYYY-MM-DD'), res.data.user.profile.display_name, urlLinks);
            })
            .then(chainResults => {
                return updateCheckStatus(myCheckStatus, [['NONE', moment().format('YYYY-MM-DD'), myCheckStatus.order_option_ids]])
            })
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


// google API
const tokenStorage = {
    access_token: null,
    token_type: null,
    expiry_date: null
};

function getAccessToken() {
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
                title: slackUserCheckStatus.slackUser.profile.display_name + ' 꾸미기포인트 지급 DM 타이틀   ' + slackUserCheckStatus.checkStatus.status,
                fallback: '꾸미기포인트 지급 DM',
                callback_id: 'none',
                color: '#35c5f0',
                text: '꾸미기포인트 지급 DM 텍스트',
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
        text: slackUserCheckStatus.slackUser.profile.display_name + ' 배송 완료',
        attachments: []
    };
    slackUserCheckStatus.completedDeliveries.forEach(completedDelivery => {
        json.attachments.push({
            title: completedDelivery.order_option_id + "     " + completedDelivery.brand_name + "     " + completedDelivery.name + "     " + completedDelivery.delivery_complete_date,
            fallback: '배송완료 DM',
            callback_id: 'none',
            color: '#35c5f0',
            text: '배송완료 DM 텍스트',
        });
    })
    return json;
}

function make3MonthsGoneRemindDMPayload(slackUserCheckStatus) {
    /*TODO 테스트 코드*/
    slackUserCheckStatus.slackUser.id = 'CDWKRAHEE';
    /*END*/

    const json = {
        channel: slackUserCheckStatus.slackUser.id,
        as_user: true,
        text: slackUserCheckStatus.slackUser.profile.display_name,
        attachments: []
    };
    json.attachments.push({
        title: slackUserCheckStatus.checkStatus.nickname + "     " + slackUserCheckStatus.checkStatus.updated_at + "     " + slackUserCheckStatus.checkStatus.status + "    3개월 지남. ",
        fallback: '3개월 리마인드 DM',
        callback_id: 'none',
        color: '#35c5f0',
        text: '3개월 리마인드 DM 텍스트',
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
        text: slackUserCheckStatus.slackUser.profile.display_name,
        attachments: []
    };
    json.attachments.push({
        title: slackUserCheckStatus.checkStatus.nickname + "     " + slackUserCheckStatus.checkStatus.updated_at + "     " + slackUserCheckStatus.checkStatus.status + "    담달부터 포인트 지급 제외 4개월 지남. ",
        fallback: '다음달부터 포인트 지급 제외 DM',
        callback_id: 'none',
        color: '#35c5f0',
        text: '다음달부터 포인트 지급 제외 DM 텍스트',
    });
    return json;
}

function makePointNotiDlgPayload() {
    json = {
        callback_id: 'notify-point',
        title: '포인트 공지 쓰기',
        submit_label: '보내기',
        elements: [
            {
                type: 'textarea',
                label: '내용',
                name: 'content',
                placeholder: '이번 달 @미나x2 @우디 @비스코 님에게 버그신고 포인, @미나 님에게 아이데이션 포인 드려용 모두 감사해용',
                value: null,
                optional: false,
            }
        ]
    };
    return json;
}

function makePointNotiMsgPayload(slackUsers, content) {
    /*TODO 테스트 코드*/
    config.slack.noti_channel_id = 'CDWKRAHEE';
    /*END*/

    slackUsers.forEach(slackUser => {
        content = content.replace('@' + slackUser.profile.display_name, '<@' + slackUser.id + '>');
    });
    const json = {
        channel: config.slack.noti_channel_id,
        as_user: false,
        attachments: [
            {
                title: '안녕하세요~ 오집요정이에요.',
                fallback: '안녕하세요~ 오집요정이에요.',
                callback_id: 'none',
                color: '#35c5f0',
                text: content,
            }
        ]
    };
    return json;
}

function makePointBanListMsgPayload(checkStatuses) {
    let text = '';
    checkStatuses.forEach(checkStatus => {
        text += checkStatus.nickname + ' (' + checkStatus.updated_at + '부터)\n';
    });
    if (text.length === 0) {
        text = '제외 대상이 없습니다.';
    }

    return {
        attachments: [
            {
                title: '포인트 지급제외 대상 조회',
                fallback: '포인트 지급제외 대상 조회',
                color: '#35c5f0',
                text: text,
            }
        ]
    };
}

function makeCardShareDlgPayload() {
    json = {
        callback_id: 'share-card',
        title: '꾸미기지원금을 사용한 사진 공유하기',
        submit_label: '공유하기',
        elements: [
            {
                type: 'text',
                label: '링크1 (필수)',
                name: 'link_url_1',
                placeholder: 'https://ohou.se/contents/card_collections/1234',
                value: null,
                optional: false,
                hint: '사진이나 포토리뷰 링크를 공유해주세요. 이 입력창은 /up으로 다시 띄울 수 있어요.',
            },
            {
                type: 'text',
                label: '링크2 (선택)',
                name: 'link_url_2',
                placeholder: '',
                value: null,
                optional: true,
            },
            {
                type: 'text',
                label: '링크3 (선택)',
                name: 'link_url_3',
                placeholder: '',
                value: null,
                optional: true,
            },
            {
                type: 'text',
                label: '링크4 (선택)',
                name: 'link_url_4',
                placeholder: '',
                value: null,
                optional: true,
            },
            {
                type: 'text',
                label: '링크5 (선택)',
                name: 'link_url_5',
                placeholder: '',
                value: null,
                optional: true,
            }
        ]
    };
    return json;
}


// Start the server
const PORT = process.env.PORT || 12000;
// const PORT = process.env.PORT || 55000;
app.listen(PORT, () => {
    console.log(`App listening on port ${PORT}`);
    console.log('Press Ctrl+C to quit.');
});